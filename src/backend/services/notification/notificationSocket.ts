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
    type AckedSend,
    type SocketService,
} from '../socket/SocketService.js';
import type { IConfig } from '../../types.js';

/**
 * The desktop's notification wire, kept byte for byte while its delivery moves
 * underneath it. `notif.message`, `notif.unreads` and `notif.ack` are a live
 * GUI contract, so the adapter is the one place they are shaped, whichever path
 * produced the notification.
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

export type NotifWire = 'notif.message' | 'notif.unreads' | 'notif.ack';

export const NOTIF_DELIVERY_EVENT = 'outer.notif.delivery';

/** Default receipt window for a delivered `notif.message`. */
export const DEFAULT_NOTIFICATION_ACK_TIMEOUT_MS = 5_000;

/**
 * Asked of an app's own sockets with `{ uid }`. A client acknowledges once its
 * live notification feed has received that notification.
 */
export const NOTIF_RECEIPT_EVENT = 'notif.receipt';

interface MessageResponse {
    uid: string;
    notification: unknown;
}

const typeOf = (notification: unknown): string | undefined => {
    const type = (notification as { type?: unknown } | null)?.type;
    return typeof type === 'string' ? type : undefined;
};

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

/** Configured receipt window for a delivered `notif.message`. */
export const notificationAckTimeoutMs = (config: IConfig): number => {
    const configured = Number(config.notificationAckTimeoutMs);
    return Number.isFinite(configured) && configured > 0
        ? configured
        : DEFAULT_NOTIFICATION_ACK_TIMEOUT_MS;
};

/** What a receipt heard back, from either kind of acked send. */
interface Heard {
    responses: unknown[];
    /** A socket here got it. */
    reached: boolean;
    ackCapable: boolean;
    everySocketAcks: boolean;
    complete: boolean;
}

const heardFromSend = (sent: AckedSend): Heard => ({
    responses: sent.responses,
    reached: sent.sockets > 0,
    ackCapable: sent.acking > 0,
    everySocketAcks: sent.acking === sent.sockets,
    complete: sent.complete,
});

/** An ack-capable socket either answered or let the ask time out. */
const heardFromAsk = (asked: AckedAsk): Heard => {
    const ackCapable = asked.responses.length > 0 || asked.timedOut;
    return {
        responses: asked.responses,
        reached: ackCapable || asked.others,
        ackCapable,
        everySocketAcks: !asked.others,
        complete: asked.complete,
    };
};

/** An incomplete count never reads as nobody being here. */
const deliveryOutcome = (
    heard: Heard,
    peerRegions: boolean,
): NotifDeliveryOutcome => {
    if (heard.responses.length > 0) return 'received';
    if (heard.reached || !heard.complete) return 'unreceived';
    return peerRegions ? 'remote-only' : 'no-socket';
};

const responderOf = (response: unknown): NotifDeliveryResponder => {
    const state = (response as { visibilityState?: unknown } | null)
        ?.visibilityState;
    return {
        visibilityState:
            state === 'visible' || state === 'hidden' ? state : 'unknown',
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

/** What a receipt settles; `appUid` names the app whose sockets were asked. */
interface ReceiptScope {
    userId: number;
    uid: string;
    type?: string;
    sendId?: string;
    appUid: string | null;
}

export class NotificationSocketAdapter {
    readonly #deps: AdapterDeps;

    constructor(deps: AdapterDeps) {
        this.#deps = deps;
    }

    /** Only the emitting region waits on receipts for a `notif.message`. */
    attach(): void {
        this.#deps.event.on(NOTIF_DELIVERY_EVENT, (_key, data, meta) => {
            const { userId, wire, response, sendId } = data;
            if (wire === 'notif.message' && !meta?.from_outside) {
                this.#deliverMessage(
                    userId,
                    response as MessageResponse,
                    sendId,
                );
                return;
            }
            void this.#deps.socket
                .send({ room: userId }, wire, response)
                .catch((err: unknown) => {
                    console.warn('[notification] socket send failed', err);
                });
        });
    }

    /** One notification, in the shape `UIDesktop` has always received. */
    message(
        userId: number,
        uid: string,
        notification: unknown,
        sendId?: string,
    ): void {
        const response = { uid, notification };
        if (this.#dispatched(userId, 'notif.message', response, sendId)) {
            return;
        }
        this.#deliverMessage(userId, response, sendId);
        this.#deps.event.emit(
            'outer.gui.notif.message',
            { user_id_list: [userId], response },
            { region_delivered: true },
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

    /**
     * Asks the app's own sockets whether its live copy of `uid` reached them,
     * and settles that like a desktop delivery, marked with `appUid`. Resolves
     * the settle it emitted, or null when asking failed.
     */
    appReceipt(scope: {
        userId: number;
        appUid: string;
        uid: string;
        type: string;
        sendId?: string;
    }): Promise<SettledDelivery | null> {
        const { userId, appUid, uid } = scope;
        return this.#settle(scope, async () =>
            heardFromAsk(
                await this.#deps.socket.askWithAck(
                    { room: appSocketRoom(userId, appUid) },
                    NOTIF_RECEIPT_EVENT,
                    { uid },
                    { timeoutMs: this.#deps.ackTimeoutMs() },
                ),
            ),
        );
    }

    /** Whether this region holds a socket for the recipient right now. */
    hasSocket(userId: number): boolean {
        return this.#deps.socket.has({ room: userId });
    }

    #deliverMessage(
        userId: number,
        response: MessageResponse,
        sendId?: string,
    ): void {
        const scope: ReceiptScope = {
            userId,
            uid: response.uid,
            type: typeOf(response.notification),
            sendId,
            appUid: null,
        };
        void this.#settle(scope, async () =>
            heardFromSend(
                await this.#deps.socket.sendWithAck(
                    { room: userId },
                    'notif.message',
                    response,
                    { timeoutMs: this.#deps.ackTimeoutMs() },
                ),
            ),
        );
    }

    async #settle(
        scope: ReceiptScope,
        hear: () => Promise<Heard>,
    ): Promise<SettledDelivery | null> {
        const { userId, uid, type, sendId, appUid } = scope;
        try {
            const [heard, peerRegions] = await Promise.all([
                hear(),
                this.#deps.heldInPeerRegion(userId, appUid),
            ]);
            const settled: SettledDelivery = {
                ...(sendId ? { sendId } : {}),
                uid,
                userId,
                ...(type ? { type } : {}),
                ...(appUid ? { appUid } : {}),
                outcome: deliveryOutcome(heard, peerRegions),
                ackCapable: heard.ackCapable,
                everySocketAcks: heard.everySocketAcks,
                complete: heard.complete,
                peerRegions,
                responders: heard.responses.map(responderOf),
            };
            this.#deps.event.emit(
                'notif.delivery.settled',
                structuredClone(settled),
                {},
            );
            return settled;
        } catch (err) {
            console.warn('[notification] socket send failed', err);
            return null;
        }
    }

    /** Take the events-layer route, or report that the legacy one applies. */
    #dispatched(
        userId: number,
        wire: NotifWire,
        response: unknown,
        sendId?: string,
    ): boolean {
        if (!this.#deps.foldIn()) return false;
        this.#deps.event.emit(
            NOTIF_DELIVERY_EVENT,
            { userId, wire, response, ...(sendId ? { sendId } : {}) },
            {},
        );
        return true;
    }
}
