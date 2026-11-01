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

import type {
    EventsWorkerInvokerClient,
    WorkerInvokeOptions,
} from '../../clients/events/EventsWorkerInvokerClient.js';
import type { Actor } from '../../core/actor.js';
import type { DeliverableEvent } from './registry.js';

/**
 * Where a delivery leaves the event system for the app's own code.
 *
 * An invocation is not an ack: a `single` delivery stays leased until the
 * invoker reports the handler took it, so a handler that never ran cannot look
 * like one that succeeded.
 */

/** What a schedule's handler is handed as `event`. */
export interface ScheduleEvent {
    subject: string;
    op: 'tick';
    /** `${scheduleId}:${scheduledFor}`: the same across retries of one slot. */
    id: string;
    scheduleId: string;
    scheduledFor: number;
    /** When the invocation was sent; stamped as it goes out. */
    firedAt?: number;
    /** Slots skipped since the last one that ran. */
    missed: number;
    missedCapped?: true;
    /** Attempts at this slot, this one included. */
    attempt: number;
}

/** One handler call, as the seam receives it. */
export interface WorkerInvocation {
    subId: string;
    /** Whose subscription this is, and who is billed for the work. */
    holderUserId: number;
    /** The app whose handler runs, or null for an account-owned row. */
    appUid: string | null;
    handlerName: string | null;
    event: DeliverableEvent | ScheduleEvent;
    /** The subscription's stored context, delivered to the handler as `ctx`. */
    context: string | null;
    /** Handler runs behind `event`; the token this run is handed is one deeper. */
    handlerDepth: number;
    /** The holder acting as the app, when the caller resolved it already. */
    actor?: Actor;
}

/**
 * `settled`: delivered. `terminal`: handler refused, not retried. `retriable`:
 * the handler failed, comes back. `unavailable`: Puter could not run it, comes
 * back. `deferred`: nothing attempted. Only `terminal` and `retriable` count
 * toward the run that suspends a subscription.
 */
export type WorkerInvocationOutcome =
    'settled' | 'terminal' | 'retriable' | 'unavailable' | 'deferred';

export interface WorkerInvocationResult {
    outcome: WorkerInvocationOutcome;
    /** Least wait before the next attempt, when the answer named one. */
    retryAfterMs?: number;
}

export interface WorkerInvokerSeam {
    invoke(invocation: WorkerInvocation): Promise<WorkerInvocationResult>;
    /** Whether this seam can take an invocation at all. Absent means yes. */
    available?(): boolean;
}

/**
 * Why no token could be minted: nobody to run as, no consent to, or the mint
 * itself failed.
 */
export type MintRefusal = 'no-identity' | 'no-consent' | 'mint-failed';

/**
 * Mints the subscriber's app-under-user token for one invocation. The
 * `events:background` consent is what authorizes it, not a narrower
 * credential.
 */
export type SubscriberTokenMinter = (
    invocation: WorkerInvocation,
) => Promise<{ token: string } | { refused: MintRefusal }>;

/** Where the handler set is read from when its cache misses. */
export interface AddressOptions {
    missRead?: 'primary' | 'replica';
}

/**
 * The script an app's handlers deploy as and its invocation key; null when the
 * app has no handlers or no events secret is configured.
 */
export type EventsWorkerAddresser = (
    appUid: string,
    options?: AddressOptions,
) => Promise<{ script: string; key: string } | null>;

/** What one run came to, including why nothing was invoked. */
export type WorkerRunResult =
    WorkerInvocationResult | { outcome: MintRefusal | 'deploy-busy' };

/** How {@link EventsWorkerInvoker.run} reaches the worker. */
export type WorkerRunOptions = WorkerInvokeOptions & AddressOptions;

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
    readonly #available: () => boolean;
    /**
     * Script -> when it was last logged, so a failing script floods once a
     * minute.
     */
    readonly #warned = new Map<string, number>();

    constructor(
        client: Pick<EventsWorkerInvokerClient, 'invoke'>,
        mintToken: SubscriberTokenMinter,
        address: EventsWorkerAddresser,
        available: () => boolean,
    ) {
        this.#client = client;
        this.#mintToken = mintToken;
        this.#address = address;
        this.#available = available;
    }

    available(): boolean {
        return this.#available();
    }

    async invoke(
        invocation: WorkerInvocation,
    ): Promise<WorkerInvocationResult> {
        const result = await this.run(invocation);
        switch (result.outcome) {
            // Nothing was attempted.
            case 'no-identity':
            case 'no-consent':
            case 'mint-failed':
                return { outcome: 'deferred' };
            case 'deploy-busy':
                return { outcome: 'unavailable' };
            default:
                return result;
        }
    }

    /** {@link invoke}, saying why nothing was invoked. */
    async run(
        invocation: WorkerInvocation,
        options: WorkerRunOptions = {},
    ): Promise<WorkerRunResult> {
        const { appUid, handlerName } = invocation;
        if (!appUid || !handlerName) return { outcome: 'deferred' };
        if (!this.#available()) return { outcome: 'unavailable' };

        const minted = await this.#mintToken(invocation);
        if ('refused' in minted) return { outcome: minted.refused };

        // Nowhere to send it: the app has no handlers or no owner to run them
        // as. Retrying cannot fix that, so the consecutive-failure rule is what
        // stops it.
        const address = await this.#address(appUid, {
            missRead: options.missRead,
        });
        if (address === null) return { outcome: 'retriable' };

        const result = await this.#client.invoke(
            {
                script: address.script,
                key: address.key,
                appUid,
                handler: handlerName,
                token: minted.token,
                event: invocation.event,
                ctx: parseContext(invocation.context),
            },
            {
                lane: options.lane,
                stampEvent: options.stampEvent,
                gateDeploy: options.gateDeploy,
            },
        );
        if (result.deployBusy) return { outcome: 'deploy-busy' };
        if (
            (result.outcome === 'retriable' ||
                result.outcome === 'unavailable') &&
            result.error
        )
            this.#warnRetriable(address.script, appUid, result.error);
        return {
            outcome: result.outcome,
            ...(result.retryAfterMs
                ? { retryAfterMs: result.retryAfterMs }
                : {}),
        };
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

    invoke(invocation: WorkerInvocation): Promise<WorkerInvocationResult> {
        this.recorded.push(invocation);
        if (this.recorded.length > RECORDED_INVOCATIONS) this.recorded.shift();
        return Promise.resolve({ outcome: 'deferred' });
    }
}
