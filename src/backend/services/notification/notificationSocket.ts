/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import type { EventClient } from '../../clients/event/EventClient.js';
import type {
    EventMap,
    NotifDeliveryOutcome,
    NotifDeliveryResponder,
} from '../../clients/event/types.js';
import {
    appSocketRoom,
    type AckedAsk,
    type SocketService,
} from '../socket/SocketService.js';
import type { IConfig } from '../../types.js';

/**
 * The desktop's notification wire, kept byte for byte while its delivery moves
 * underneath it. `notif.message`, `notif.unreads`, `notif.ack` and
 * `notif.removed` are a live GUI contract, so the adapter is the one place they
 * are shaped, whichever path produced the notification.
 *
 * Two routes, one wire:
 *
 * - **Fold-in off** — the `outer.gui.notif.*` bus events, which `SocketService`
 *   fans to the user's room in every region.
 * - **Fold-in on** — the events layer decides the delivery, and this pushes it as
 *   `outer.notif.delivery`. That key reaches peer regions over the webhook fan
 *   and never sibling nodes, so each region sends exactly once, and it is
 *   outside `outer.gui.*` so the notification does not also ride the fan the
 *   GUI mutation events do. One socket, one copy.
 *
 * The GUI reads notifications from `puter.events` wherever the fold-in is
 * advertised (`gui_params.eventsNotifications`) and falls back to this wire
 * when that lapses, so the adapter is what keeps older clients and the fallback
 * working. It goes when the flag is on everywhere.
 */

export type NotifWire =
    'notif.message' | 'notif.unreads' | 'notif.ack' | 'notif.removed';

export const NOTIF_DELIVERY_EVENT = 'outer.notif.delivery';

/** Default receipt window for a live notification. */
export const DEFAULT_NOTIFICATION_ACK_TIMEOUT_MS = 5_000;

/**
 * Asked of the desktop's or an app's sockets with `{ uid }`. A client answers
 * once its page has received that notification live, or with `{ received: false
 * }` when it never does.
 */
export const NOTIF_RECEIPT_EVENT = 'notif.receipt';

/** One unread as the replay payload carries it. */
export interface UnreadNotification {
    uid: string;
    notification: unknown;
    created_at: unknown;
}

/**
 * Whether notification delivery goes through events dispatch. Absent is off,
 * and the master events switch gates it: the fold-in has nowhere to dispatch
 * from with the surface itself turned off.
 */
export const notificationsFoldInEnabled = (config: IConfig): boolean =>
    config.events?.enabled === true &&
    config.events?.notificationsFoldIn === true;

/** Configured receipt window for a live notification. */
export const notificationAckTimeoutMs = (config: IConfig): number => {
    const configured = Number(config.notificationAckTimeoutMs);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_NOTIFICATION_ACK_TIMEOUT_MS;
};

/** An incomplete count never reads as nobody being here. */
const deliveryOutcome = (
    asked: AckedAsk,
    responders: NotifDeliveryResponder[],
    peerRegions: boolean,
): NotifDeliveryOutcome => {
    if (responders.length > 0) return 'received';
    // An ack-capable socket answered without it or let the ask time out.
    if (
        asked.responses.length > 0 ||
        asked.timedOut ||
        asked.others ||
        !asked.complete
    )
        return 'unreceived';
    return peerRegions ? 'remote-only' : 'no-socket';
};

/** Null for a page that answered without the notification. */
const responderOf = (response: unknown): NotifDeliveryResponder | null => {
    const answer = (
        response && typeof response === 'object' ? response : {}
    ) as Record<string, unknown>;
    if (answer.received === false) return null;
    const state = answer.visibilityState;
    return {
        visibilityState:
            state === 'visible' || state === 'hidden' ? state : 'unknown',
        ...(typeof answer.focused === 'boolean'
            ? { focused: answer.focused }
            : {}),
        ...(typeof answer.showsOwn === 'boolean'
            ? { showsOwn: answer.showsOwn }
            : {}),
    };
};

interface AdapterDeps {
    event: EventClient;
    socket: SocketService;
    foldIn: () => boolean;
    ackTimeoutMs: () => number;
    /** Whether a peer region holds a socket for the user, or for this app. */
    heldInPeerRegion: (
        userId: number,
        appUid: string | null,
    ) => Promise<boolean>;
}

type SettledDelivery = EventMap['notif.delivery.settled'];

/** What a receipt settles; `appUid` names the app whose sockets are asked. */
export interface ReceiptScope {
    userId: number;
    /** Null asks the desktop's sockets. */
    appUid: string | null;
    uid: string;
    type: string;
    sendId?: string;
}

export class NotificationSocketAdapter {
    readonly #deps: AdapterDeps;

    constructor(deps: AdapterDeps) {
        this.#deps = deps;
    }

    /**
     * Start delivering what the events layer dispatches. Both the region that
     * emitted and the peers that received it land here exactly once, so the
     * handler makes no distinction between them.
     */
    attach(): void {
        this.#deps.event.on(NOTIF_DELIVERY_EVENT, (_key, data) => {
            const { userId, wire, response } = data;
            void this.#deps.socket
                .send({ room: userId }, wire, response)
                .catch((err: unknown) => {
                    console.warn('[notification] socket send failed', err);
                });
        });
    }

    /** One notification, in the shape `UIDesktop` has always received. */
    message(userId: number, uid: string, notification: unknown): void {
        const response = { uid, notification };
        if (this.#dispatched(userId, 'notif.message', response)) return;
        this.#deps.event.emit(
            'outer.gui.notif.message',
            { user_id_list: [userId], response },
            {},
        );
    }

    /** The unread replay a client gets when it reconnects. */
    unreads(userId: number, unreads: UnreadNotification[]): void {
        const response = { unreads };
        if (this.#dispatched(userId, 'notif.unreads', response)) return;
        this.#deps.event.emit(
            'outer.gui.notif.unreads',
            { user_id_list: [userId], response },
            {},
        );
    }

    /** "Stop showing this", to the recipient's other tabs. */
    ack(userId: number, uid: string): void {
        const response = { uid };
        if (this.#dispatched(userId, 'notif.ack', response)) return;
        this.#deps.event.emit(
            'outer.gui.notif.ack',
            { user_id_list: [userId], response },
            {},
        );
    }

    /** "This is gone", to the recipient's other tabs. */
    removed(userId: number, uid: string): void {
        const response = { uid };
        if (this.#dispatched(userId, 'notif.removed', response)) return;
        this.#deps.event.emit(
            'outer.gui.notif.removed',
            { user_id_list: [userId], response },
            {},
        );
    }

    /**
     * Asks the desktop's sockets, or with `appUid` the app's own, whether the
     * live copy of `uid` reached a page, and settles that as
     * `notif.delivery.settled`. Resolves the settle it emitted, or null when
     * asking failed.
     */
    async receipt(scope: ReceiptScope): Promise<SettledDelivery | null> {
        const { userId, appUid, uid, type, sendId } = scope;
        try {
            const [asked, peerRegions] = await Promise.all([
                this.#deps.socket.askWithAck(
                    { room: appUid ? appSocketRoom(userId, appUid) : userId },
                    NOTIF_RECEIPT_EVENT,
                    { uid },
                    { timeoutMs: this.#deps.ackTimeoutMs() },
                ),
                this.#deps.heldInPeerRegion(userId, appUid),
            ]);
            const responders = asked.responses.flatMap((response) => {
                const responder = responderOf(response);
                return responder ? [responder] : [];
            });
            const settled: SettledDelivery = {
                ...(sendId ? { sendId } : {}),
                uid,
                userId,
                type,
                ...(appUid ? { appUid } : {}),
                outcome: deliveryOutcome(asked, responders, peerRegions),
                ackCapable: asked.responses.length > 0 || asked.timedOut,
                everySocketAcks: !asked.others,
                complete: asked.complete,
                peerRegions,
                responders,
            };
            this.#deps.event.emit(
                'notif.delivery.settled',
                structuredClone(settled),
                {},
            );
            return settled;
        } catch (err) {
            console.warn('[notification] receipt failed', err);
            return null;
        }
    }

    /** Whether this region holds a socket for the recipient right now. */
    hasSocket(userId: number): boolean {
        return this.#deps.socket.has({ room: userId });
    }

    /** Take the events-layer route, or report that the legacy one applies. */
    #dispatched(userId: number, wire: NotifWire, response: unknown): boolean {
        if (!this.#deps.foldIn()) return false;
        this.#deps.event.emit(
            NOTIF_DELIVERY_EVENT,
            { userId, wire, response },
            {},
        );
        return true;
    }
}
