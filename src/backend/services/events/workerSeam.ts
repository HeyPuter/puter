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

import type { DeliverableEvent } from './registry.js';

/**
 * Where a delivery leaves the event system for the app's own code.
 *
 * The invoker itself — minting the subscriber-scoped token, the call, its
 * retries — is not built yet, and delivery semantics must not wait for it: what
 * runs a handler is one decision, and how many times a `single` may be handed
 * out is another. So the seam is the boundary, and the default records the
 * intent without acting on it.
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
}

/**
 * What the invoker did with it. `settled` means the handler took the delivery
 * and its lease may be released; `deferred` means it has not, and the delivery
 * stays owed.
 */
export type WorkerInvocationOutcome = 'settled' | 'deferred';

export interface WorkerInvokerSeam {
    invoke(invocation: WorkerInvocation): Promise<WorkerInvocationOutcome>;
}

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
