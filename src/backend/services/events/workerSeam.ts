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

import type { EventsWorkerInvokerClient } from '../../clients/events/EventsWorkerInvokerClient.js';
import type { DeliverableEvent } from './registry.js';

/**
 * Where a delivery leaves the event system for the app's own code.
 *
 * An invocation is not an ack: a `single` delivery stays leased until the
 * invoker reports the handler took it, so a handler that never ran cannot look
 * like one that succeeded.
 */

/** One handler call, as the seam receives it. */
export interface WorkerInvocation {
    subId: string;
    /** Whose subscription this is, and who is billed for the work. */
    holderUserId: number;
    /** The app whose handler runs, or null for an account-owned row. */
    appUid: string | null;
    handlerName: string | null;
    event: DeliverableEvent;
    /** The subscription's stored context, delivered to the handler as `ctx`. */
    context: string | null;
}

/**
 * What the invoker did with it.
 *
 * - `settled` — the handler took the delivery and its lease may be released.
 * - `terminal` — the handler refused it. Nothing is gained by sending it again.
 * - `retriable` — nobody could answer; the delivery is owed and comes back.
 * - `deferred` — nothing was attempted, so nothing failed either.
 *
 * `terminal` and `retriable` are both failures and both count toward the run
 * that suspends a subscription; they differ only in whether the delivery itself
 * gets another turn.
 */
export type WorkerInvocationOutcome =
    | 'settled'
    | 'terminal'
    | 'retriable'
    | 'deferred';

export interface WorkerInvokerSeam {
    invoke(invocation: WorkerInvocation): Promise<WorkerInvocationOutcome>;
}

/**
 * Mints the token one invocation carries: the subscriber's own app-under-user
 * identity, the same one the app acts with for this user in a tab. Not a
 * grant-scoped token — the `events:background` consent is what authorizes
 * running the app's code with nobody present, not a narrower credential.
 */
export type SubscriberTokenMinter = (
    invocation: WorkerInvocation,
) => Promise<string | null>;

/**
 * Where an app's handlers currently live: the script its published set deploys
 * as, and the key an invocation of that script carries. Null when the app has
 * no handlers, or the deployment has no events secret to derive a key from.
 */
export type EventsWorkerAddresser = (
    appUid: string,
) => Promise<{ script: string; key: string } | null>;

/** How often the same script's retriable failures are logged. */
const WARN_INTERVAL_MS = 60_000;
/** Distinct scripts one process tracks a last-warned time for. */
const WARN_MAP_MAX_ENTRIES = 1000;

/**
 * The invoker that actually calls an app's events worker: mint the subscriber's
 * token, address the app's current set, and report what the handler said. A row
 * with no app, no handler name, or no mintable token has nothing to invoke, and
 * says so rather than reporting a failure.
 */
export class EventsWorkerInvoker implements WorkerInvokerSeam {
    readonly #client: Pick<EventsWorkerInvokerClient, 'invoke'>;
    readonly #mintToken: SubscriberTokenMinter;
    readonly #address: EventsWorkerAddresser;
    /**
     * Script -> when it was last logged, so a failing script floods once a
     * minute.
     */
    readonly #warned = new Map<string, number>();

    constructor(
        client: Pick<EventsWorkerInvokerClient, 'invoke'>,
        mintToken: SubscriberTokenMinter,
        address: EventsWorkerAddresser,
    ) {
        this.#client = client;
        this.#mintToken = mintToken;
        this.#address = address;
    }

    async invoke(
        invocation: WorkerInvocation,
    ): Promise<WorkerInvocationOutcome> {
        const { appUid, handlerName } = invocation;
        if (!appUid || !handlerName) return 'deferred';

        const token = await this.#mintToken(invocation);
        if (token === null) return 'deferred';

        // Nowhere to send it yet. Retriable rather than terminal: the address
        // is the platform's to provide, and the app has done nothing wrong —
        // the consecutive-failure rule is what stops this retrying forever.
        const address = await this.#address(appUid);
        if (address === null) return 'retriable';

        const result = await this.#client.invoke({
            script: address.script,
            key: address.key,
            appUid,
            handler: handlerName,
            token,
            event: invocation.event,
            ctx: parseContext(invocation.context),
        });
        if (result.outcome === 'retriable' && result.error)
            this.#warnRetriable(address.script, appUid, result.error);
        return result.outcome;
    }

    #warnRetriable(script: string, appUid: string, error: string): void {
        const now = Date.now();
        const last = this.#warned.get(script);
        if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
        this.#warned.set(script, now);
        if (this.#warned.size > WARN_MAP_MAX_ENTRIES) {
            for (const [key, ts] of this.#warned)
                if (now - ts >= WARN_INTERVAL_MS) this.#warned.delete(key);
            // Nothing was stale enough to drop, so forget the window rather
            // than let the map grow with the number of failing scripts.
            if (this.#warned.size > WARN_MAP_MAX_ENTRIES) this.#warned.clear();
        }
        console.warn('[events] invoke failed', { appUid, script, error });
    }
}

/** Context is stored as JSON text and delivered as the object it was. */
const parseContext = (context: string | null): unknown => {
    if (context === null) return undefined;
    try {
        return JSON.parse(context) as unknown;
    } catch {
        return undefined;
    }
};

/** Invocations one recorder holds, so it cannot grow with event volume. */
const RECORDED_INVOCATIONS = 100;

/**
 * The seam until there is something to run handlers. Records what would have
 * been invoked and settles nothing, so a delivery handed here stays owed and is
 * retried rather than quietly disappearing.
 */
export class RecordingWorkerInvoker implements WorkerInvokerSeam {
    readonly recorded: WorkerInvocation[] = [];

    invoke(invocation: WorkerInvocation): Promise<WorkerInvocationOutcome> {
        this.recorded.push(invocation);
        if (this.recorded.length > RECORDED_INVOCATIONS) this.recorded.shift();
        return Promise.resolve('deferred');
    }
}
