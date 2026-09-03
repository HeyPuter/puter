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
 * The seam is the boundary between "this delivery is owed to a handler" and
 * "something ran it": what runs a handler is one decision, and how many times a
 * `single` may be handed out is another.
 *
 * An invocation is not an ack. A `single` delivery stays leased until the
 * invoker reports the handler took it, which is what keeps a handler that never
 * ran from looking like one that succeeded.
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
    /**
     * The grant the subscription was made under, and the whole of what its
     * token may carry. Resolved with the row so the invoker needs no lookup of
     * its own.
     */
    permissions: string[];
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

/** Mints the token one invocation carries, scoped to the subscriber. */
export type SubscriberTokenMinter = (
    invocation: WorkerInvocation,
) => Promise<string | null>;

/**
 * The invoker that actually calls an app's events worker: mint the
 * subscriber-scoped token, hand the call to the protocol client, and report
 * what the handler said.
 *
 * A row with no app, no handler name, or no token that can be minted for it has
 * nothing to invoke, and says so rather than reporting a failure — there is no
 * handler to blame for a row that never named one.
 */
export class EventsWorkerInvoker implements WorkerInvokerSeam {
    readonly #client: Pick<EventsWorkerInvokerClient, 'invoke'>;
    readonly #mintToken: SubscriberTokenMinter;

    constructor(
        client: Pick<EventsWorkerInvokerClient, 'invoke'>,
        mintToken: SubscriberTokenMinter,
    ) {
        this.#client = client;
        this.#mintToken = mintToken;
    }

    async invoke(
        invocation: WorkerInvocation,
    ): Promise<WorkerInvocationOutcome> {
        const { appUid, handlerName } = invocation;
        if (!appUid || !handlerName) return 'deferred';

        const token = await this.#mintToken(invocation);
        if (token === null) return 'deferred';

        const result = await this.#client.invoke({
            appUid,
            handler: handlerName,
            token,
            event: invocation.event,
            ctx: parseContext(invocation.context),
        });
        return result.outcome;
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
