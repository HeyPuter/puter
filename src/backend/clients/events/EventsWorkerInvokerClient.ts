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

// Claims the global dispatcher slot for Node's own fetch before npm `undici`
// can — see the guard's own comment.
import '../../util/nodeFetchDispatcherGuard.js';

import { Agent, fetch as undiciFetch } from 'undici';
import { PuterClient } from '../types.js';

/**
 * The call that leaves the platform and runs an app's own code.
 *
 * Events workers are unreachable from the internet: deployed into their own
 * dispatch namespace and reached only through the events dispatcher, which
 * answers on its own hostname behind the internal secret.
 *
 *     POST <events dispatcher>/invoke
 *     x-puter-internal-auth:  <internal secret>
 *     x-puter-events-script:  <script the handler set deploys as>
 *     x-puter-events-app:     <app uid, for the deploy-on-miss callback>
 *     x-puter-events-holder:  <holder uuid of a user scope; absent for app scope>
 *     x-puter-events-key:     <key derived for that script>
 *     { handler, event, ctx, token }
 *
 * The delivery token rides in the body, not a header, so nothing between here
 * and the isolate can treat it as its own authorization.
 *
 * On a miss, a handler set here may deploy the script itself and retry once
 * with `x-puter-events-deployed: 1`, skipping the dispatcher's own callback.
 *
 * Calls that come due within a few milliseconds of each other go out together:
 *
 *     POST <events dispatcher>/invoke-batch
 *     x-puter-internal-auth:  <internal secret>
 *     { calls: [{ script, appUid, holder?, key, deployed?, body, waitMs }] }
 *
 * The dispatcher runs a few at a time, in order, and streams NDJSON: `{ i,
 * started: true }` when a call goes to its worker, then `{ i, status, handled?,
 * error?, retryAfter?, dispatch? }` when it finishes — the same facts the
 * single route carries in its status and headers. A call's timeout runs from
 * its `started` line, so time spent queued behind other calls is never the
 * handler's. A call still queued `waitMs` after the batch arrived is never
 * started and answers `dispatch: "queue-timeout"`.
 */

/** The one route an events worker answers. */
export const EVENTS_INVOKE_PATH = '/__events/invoke';

/** The route the events dispatcher takes an invocation on. */
export const EVENTS_DISPATCH_PATH = '/invoke';

/** The route it takes several on, answering each as it finishes. */
export const EVENTS_DISPATCH_BATCH_PATH = '/invoke-batch';

/** Calls one batch carries at most. */
export const INVOKE_BATCH_SIZE = 60;

/** How long the first call of a batch waits for others to join it. */
export const INVOKE_BATCH_WINDOW_MS = 5;

/**
 * How long a dispatcher without the batch route is sent single calls before the
 * batch route is tried again.
 */
const BATCH_UNSUPPORTED_RETRY_MS = 5 * 60_000;

/**
 * How long past its wait a batched call's `started` line may take to arrive
 * before the call is given up as never started.
 */
const BATCH_START_GRACE_MS = 2_000;

/**
 * Header the dispatcher marks its own failures with. Anything carrying it never
 * reached a handler, so its status says nothing about the delivery.
 */
export const EVENTS_DISPATCH_ERROR_HEADER = 'x-puter-events-dispatch';

/**
 * Header a script's own answer carries, whatever its status — set by the
 * runtime itself and re-stamped by the dispatcher, so a 4xx with neither this
 * nor the dispatch-error header came from neither (an edge 404, a WAF) and is
 * retriable rather than a handler's refusal.
 */
export const EVENTS_HANDLED_HEADER = 'x-puter-events-handled';

/** Machine-readable reason on the runtime's own failure answers. */
export const EVENTS_ERROR_HEADER = 'x-puter-events-error';

/**
 * The runtime's answer to a key it does not hold: the script was deployed under
 * a secret that has since rotated, and redeploying it binds the current key.
 */
const BAD_KEY_ERROR = 'bad-key';

/**
 * Runtime failure answers that are Puter's fault rather than the handler's: a
 * key the script no longer matches, no token to run as, or a handler that
 * failed because a Puter API call it made did.
 */
const PLATFORM_ERROR_CODES = new Set([
    BAD_KEY_ERROR,
    'no-token',
    'platform-error',
]);

/**
 * Set on the retry after this backend deploys a missing script itself, so the
 * dispatcher skips its own deploy-on-miss callback and negative cache and goes
 * straight to retrying the namespace.
 */
export const EVENTS_DEPLOYED_HEADER = 'x-puter-events-deployed';

/**
 * Names the user whose scope a script belongs to, so a miss deploys it from
 * their handlers. Absent for an app's own scope.
 */
export const EVENTS_HOLDER_HEADER = 'x-puter-events-holder';

/**
 * Dispatch-error reasons this backend can resolve itself by deploying, rather
 * than wait on the rehydrate callback finding a backend behind the dispatcher's
 * own hostname. `deploy-timeout` is not one of them: it is only ever answered
 * after a deploy that succeeded, so the script exists and another upload of it
 * cannot make the namespace see it any sooner.
 */
const SELF_DEPLOYABLE_MISS_REASONS = new Set([
    'missing',
    'deploy-failed',
    'deploy-error',
]);

/**
 * Dispatch-error reasons where the deploy already happened and only propagation
 * is still catching up — one prompt retry with the deployed header is worth it,
 * without spending another upload on it.
 */
const ALREADY_DEPLOYED_MISS_REASONS = new Set(['deploy-timeout']);

/** Whose call asked for the deploy, for the share of deploys it may take. */
export interface WorkerMissOptions {
    lane?: InvokeLane;
    /**
     * Holder uuid of the user scope the script belongs to; absent for app
     * scope.
     */
    holder?: string;
}

/** What a self-deploy attempt did, and to which app/script it applies. */
export type WorkerMissHandler = (
    appUid: string,
    script: string,
    options: WorkerMissOptions,
) => Promise<'deployed' | string>;

/**
 * `work`'s result, or null once `ms` has passed. The work keeps running, and a
 * failure after the cutoff is logged since nothing else would see it.
 */
const withinTime = async <T>(
    work: Promise<T>,
    ms: number,
): Promise<T | null> => {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<null>((resolve) => {
        timer = setTimeout(
            () => {
                timedOut = true;
                resolve(null);
            },
            Math.max(0, ms),
        );
    });
    void (async () => {
        try {
            await work;
        } catch (err) {
            if (timedOut) console.warn('[events] deploy failed late', err);
        }
    })();
    try {
        return await Promise.race([work, limit]);
    } finally {
        clearTimeout(timer);
    }
};

/** How long a handler has to answer before the attempt is abandoned. */
export const EVENTS_INVOKE_TIMEOUT_MS = 30_000;

/**
 * How many invoke timeouts a delivery's worker lease lasts. The lease store
 * reads this, and `invoke()` keeps a whole call, deploy and resend included,
 * inside it.
 */
export const EVENTS_WORKER_LEASE_FACTOR = 2;

/**
 * Left unspent at the end of the lease, and the least a resend is worth
 * starting with: below it the call is given up as `unavailable` and retried.
 */
export const EVENTS_DEADLINE_MARGIN_MS = 5_000;

/**
 * Connections held open to the dispatcher, so a busy fleet is not
 * re-handshaking. Also how many calls one transport makes at once: a call past
 * that waits for a free one before its invoke timeout starts.
 */
export const INVOKE_CONNECTIONS = 256;

/**
 * Of those, how many schedule runs may hold at once, so a burst of schedules
 * can never take the connections event deliveries need.
 */
export const SCHEDULE_INVOKE_CONNECTIONS = 64;

/** Whose call this is, for the connection share it may take. */
export type InvokeLane = 'delivery' | 'schedule';

/** What a deploy answers when another deploy of the region holds the way. */
export const DEPLOY_BUSY = 'busy';
const INVOKE_KEEP_ALIVE_MS = 30_000;

/**
 * A call waits at most this share of its invoke timeout for a connection, so
 * the wait and the run together stay inside the worker lease (twice the
 * timeout). Past it the call fails as Puter's, not the handler's.
 */
const CONNECTION_WAIT_SHARE = 0.5;

/** One invocation, as the events service hands it over. */
export interface WorkerInvokeRequest {
    /** Script the app's current handler set deploys as. */
    script: string;
    appUid: string;
    /** Holder uuid, when the handler lives in a user scope. */
    holder?: string;
    handler: string;
    /** The subscriber's app session token. */
    token: string;
    /** Value the script compares against its own invoke-key binding. */
    key: string;
    event: unknown;
    ctx: unknown;
}

/** One invocation, as a transport delivers it. */
export interface EventsInvokeCall {
    script: string;
    appUid: string;
    /** Holder uuid of the user scope the script belongs to. */
    holder?: string;
    /** Value the script compares against its own invoke-key binding. */
    key: string;
    /** Serialized `{ handler, event, ctx, token }`. */
    body: string;
    timeoutMs: number;
    /** Set on the retry after this backend deployed the script itself. */
    deployed?: boolean;
    lane?: InvokeLane;
    /**
     * Builds `body` again at send time, for a transport that waits for a
     * connection first, so a send time stamped into it is the real one.
     */
    render?: () => string;
    /**
     * Rechecked by a transport that waits before sending; false drops the call
     * with {@link supersededAnswer}.
     */
    beforeSend?: () => Promise<boolean>;
}

/** What one attempt at delivering an invocation came back with. */
export interface EventsInvokeAnswer {
    /** `null` when no answer came back. */
    status: number | null;
    /** Set only when the answer provably came from the script. */
    handled?: boolean;
    error?: string;
    /** Set only by the dispatcher transport, naming its own failure. */
    dispatchReason?: string;
    /** No answer within the invoke timeout. */
    timedOut?: boolean;
    /** From a `retry-after` header in seconds. */
    retryAfterMs?: number;
    /** A deploy this call needed was put off: another held the way. */
    deployBusy?: boolean;
}

/**
 * Delivers an invocation. `handled` is set only when the answer provably came
 * from the script, so an unmarked 4xx is not a handler's refusal.
 */
export interface EventsInvokeTransport {
    send(call: EventsInvokeCall): Promise<EventsInvokeAnswer>;
}

/**
 * `settled`: handler accepted (2xx). `terminal`: handler refused (marked 4xx),
 * not retried. `retriable`: the handler failed or ran past the timeout.
 * `unavailable`: Puter could not start or finish the run (transport, dispatch
 * and deploy failures, unmarked answers, a Puter API failure inside the
 * handler); retried like `retriable` but never the handler's fault.
 */
export type WorkerInvokeOutcome =
    'settled' | 'terminal' | 'retriable' | 'unavailable';

export interface WorkerInvokeResult {
    outcome: WorkerInvokeOutcome;
    /** A deploy on miss was put off because another one held the way. */
    deployBusy?: boolean;
    /** The status the handler answered with, or `null` when it never did. */
    status: number | null;
    /** Why it could not answer, when nothing did. */
    error?: string;
    /** How long the answer asked to be left alone. */
    retryAfterMs?: number;
}

/** How one invocation is sent. */
export interface WorkerInvokeOptions {
    lane?: InvokeLane;
    /** Rechecked before each send, including a resend after deployment. */
    beforeSend?: () => Promise<boolean>;
    /** Applied to the event as each attempt is sent. */
    stampEvent?: (event: unknown) => unknown;
}

const NO_TRANSPORT =
    'no events dispatcher configured (url and internal secret)';

/** What a call whose `beforeSend` said no answers instead of being sent. */
const supersededAnswer = (): EventsInvokeAnswer => ({
    status: null,
    error: 'invocation superseded',
});

export class EventsWorkerInvokerClient extends PuterClient {
    /** Set only where invocations do not leave the process — local development. */
    #transport: EventsInvokeTransport | null = null;
    #dispatcher: DispatcherInvokeTransport | null = null;
    /** Lets this backend resolve a dispatcher miss instead of waiting on it. */
    #missHandler: WorkerMissHandler | null = null;

    /** Replaces the dispatcher with an in-process runtime. */
    setTransport(transport: EventsInvokeTransport): void {
        this.#transport = transport;
    }

    /**
     * Deploys a script the dispatcher reports missing, in place of the
     * rehydrate callback — for the case where that callback lands on a backend
     * other than this one — or one still bound to a rotated key. Set once;
     * `invoke()` calls it at most once per delivery and never loops.
     */
    setMissHandler(handler: WorkerMissHandler): void {
        this.#missHandler = handler;
    }

    override onServerShutdown(): void {
        this.#dispatcher?.close();
        this.#dispatcher = null;
    }

    async invoke(
        request: WorkerInvokeRequest,
        options: WorkerInvokeOptions = {},
    ): Promise<WorkerInvokeResult> {
        const transport = this.#pickTransport();
        if (!transport)
            return {
                outcome: 'unavailable',
                status: null,
                error: NO_TRANSPORT,
            };

        const { stampEvent } = options;
        const render = (): string =>
            JSON.stringify({
                handler: request.handler,
                event: stampEvent ? stampEvent(request.event) : request.event,
                ctx: request.ctx,
                token: request.token,
            });
        const timeoutMs = this.#timeoutMs();
        // The whole call, deploy and resend included, ends before the lease a
        // delivery holds would let it be claimed again mid-run.
        // A short configured timeout gets a proportionally short margin.
        const margin = Math.min(EVENTS_DEADLINE_MARGIN_MS, timeoutMs / 2);
        const deadline =
            Date.now() + timeoutMs * EVENTS_WORKER_LEASE_FACTOR - margin;
        const send = async (
            deployed: boolean,
            sendTimeoutMs = timeoutMs,
        ): Promise<EventsInvokeAnswer> => {
            if (options.beforeSend && !(await options.beforeSend()))
                return supersededAnswer();
            return transport.send({
                script: request.script,
                appUid: request.appUid,
                ...(request.holder ? { holder: request.holder } : {}),
                key: request.key,
                body: render(),
                timeoutMs: sendTimeoutMs,
                ...(deployed ? { deployed: true } : {}),
                ...(options.lane ? { lane: options.lane } : {}),
                ...(stampEvent ? { render } : {}),
                ...(options.beforeSend
                    ? { beforeSend: options.beforeSend }
                    : {}),
            });
        };

        // A send may wait for a connection for half its timeout before the
        // run's own timeout starts, so it is given what is left divided by that.
        const resend = (): Promise<EventsInvokeAnswer> | null => {
            const remaining = deadline - Date.now();
            if (remaining < margin) return null;
            return send(
                true,
                Math.floor(
                    Math.min(
                        timeoutMs,
                        remaining / (1 + CONNECTION_WAIT_SHARE),
                    ),
                ),
            );
        };
        const outOfTime = (): WorkerInvokeResult => ({
            outcome: 'unavailable',
            status: null,
            error: 'out of time to resend after deploy',
        });

        let result = await send(false);
        if (this.#missHandler && selfDeployable(result)) {
            // The deploy may be shared with other callers, so it is left
            // running when this call runs out of time for it.
            const outcome = await withinTime(
                this.#missHandler(request.appUid, request.script, {
                    lane: options.lane,
                    ...(request.holder ? { holder: request.holder } : {}),
                }),
                deadline - Date.now() - margin,
            );
            if (outcome === null) return outOfTime();
            if (outcome !== 'deployed')
                return {
                    outcome: 'unavailable',
                    status: null,
                    error: `deploy: ${outcome}`,
                    ...(outcome === DEPLOY_BUSY ? { deployBusy: true } : {}),
                };
            const resent = await resend();
            if (!resent) return outOfTime();
            result = resent;
        } else if (
            result.status === null &&
            result.dispatchReason &&
            ALREADY_DEPLOYED_MISS_REASONS.has(result.dispatchReason)
        ) {
            // No deploy to trigger — just give propagation the one retry
            // it usually needs, without spending an upload on it.
            const resent = await resend();
            if (!resent) return outOfTime();
            result = resent;
        }

        const { status, handled, error, timedOut, retryAfterMs } = result;
        if (result.deployBusy)
            return {
                outcome: 'unavailable',
                status: null,
                error,
                deployBusy: true,
            };
        // Past the timeout the handler was most likely still running, which
        // is its own doing; any other missing answer never reached it.
        if (status === null)
            return {
                outcome: timedOut ? 'retriable' : 'unavailable',
                status: null,
                error,
            };

        const outcome = outcomeForStatus(status, handled === true, error);
        // An unmarked failure is not the handler's own answer; say so even
        // when the transport did not, so the reason a delivery kept retrying
        // shows up in the log rather than reading as an unexplained retry.
        const unmarked = status >= 300 && !handled;
        const reportedError =
            error ?? (unmarked ? `unmarked ${status}` : undefined);
        return {
            outcome,
            status,
            ...(reportedError ? { error: reportedError } : {}),
            ...(retryAfterMs ? { retryAfterMs } : {}),
        };
    }

    #pickTransport(): EventsInvokeTransport | null {
        if (this.#transport) return this.#transport;
        const { dispatcherUrl, internalSecret } = this.config.events ?? {};
        // Without the secret the dispatcher would refuse every call, which is
        // a misconfiguration worth reporting once per attempt rather than a
        // round trip.
        if (!dispatcherUrl || !internalSecret) return null;
        const { invokeBatchSize, invokeBatchWindowMs } =
            this.config.events ?? {};
        this.#dispatcher ??= new DispatcherInvokeTransport(
            dispatcherUrl,
            internalSecret,
            {
                ...(invokeBatchSize !== undefined
                    ? { batchSize: invokeBatchSize }
                    : {}),
                ...(invokeBatchWindowMs !== undefined
                    ? { batchWindowMs: invokeBatchWindowMs }
                    : {}),
            },
        );
        return this.#dispatcher;
    }

    #timeoutMs(): number {
        const configured = this.config.events?.invokeTimeoutMs;
        return typeof configured === 'number' && configured > 0
            ? configured
            : EVENTS_INVOKE_TIMEOUT_MS;
    }
}

/** A call waiting in, or sent with, the current batch. */
interface BatchedCall {
    call: EventsInvokeCall;
    resolve: (answer: EventsInvokeAnswer) => void;
    /** For a `beforeSend` that threw. */
    reject: (err: unknown) => void;
    /** When its wait for a connection began, for what is left of it. */
    waitingSince: number;
}

export interface DispatcherInvokeTransportOptions {
    fetchImpl?: typeof undiciFetch;
    /** Calls per batch; 1 sends every call on its own. */
    batchSize?: number;
    batchWindowMs?: number;
}

/** Reaches an events worker the only way production can: through the dispatcher. */
export class DispatcherInvokeTransport implements EventsInvokeTransport {
    readonly #url: string;
    readonly #secret: string;
    readonly #fetchImpl: typeof undiciFetch;
    readonly #batchSize: number;
    readonly #batchWindowMs: number;
    #agent: Agent | null = null;
    /** Calls holding a connection slot. */
    #active = 0;
    /** Of those, schedule runs. */
    #scheduleActive = 0;
    /** Calls waiting for one, longest-waiting first, with their lane. */
    readonly #waiting = new Map<() => void, InvokeLane>();
    /** Calls gathered for the next batch. */
    #batch: BatchedCall[] = [];
    #batchTimer: ReturnType<typeof setTimeout> | null = null;
    /** Until when the dispatcher is taken not to have the batch route. */
    #batchUnsupportedUntil = 0;

    constructor(
        dispatcherUrl: string,
        secret: string,
        options: DispatcherInvokeTransportOptions = {},
    ) {
        // Joined as a string: `new URL(path, base)` resolves an absolute path
        // against the base's origin, dropping any path prefix it carries.
        this.#url = dispatcherUrl.replace(/\/$/, '');
        this.#secret = secret;
        this.#fetchImpl = options.fetchImpl ?? undiciFetch;
        this.#batchSize = Math.max(
            1,
            Math.floor(options.batchSize ?? INVOKE_BATCH_SIZE),
        );
        this.#batchWindowMs = Math.max(
            0,
            options.batchWindowMs ?? INVOKE_BATCH_WINDOW_MS,
        );
    }

    close(): void {
        this.#flush();
        void this.#agent?.close().catch(() => {});
        this.#agent = null;
    }

    async send(call: EventsInvokeCall): Promise<EventsInvokeAnswer> {
        // No `timedOut`: the handler never got this call, so the wait is not
        // its failure.
        const lane = call.lane ?? 'delivery';
        const waitingSince = Date.now();
        if (
            !(await this.#acquire(call.timeoutMs * CONNECTION_WAIT_SHARE, lane))
        )
            return {
                status: null,
                error: 'no free connection to the events dispatcher',
            };
        try {
            if (this.#batchSize === 1) {
                // The wait for a connection may have outlived the call.
                if (call.beforeSend && !(await call.beforeSend()))
                    return supersededAnswer();
                return await this.#sendOne(call);
            }
            return await new Promise<EventsInvokeAnswer>((resolve, reject) => {
                this.#batch.push({ call, resolve, reject, waitingSince });
                if (this.#batch.length >= this.#batchSize) this.#flush();
                else
                    this.#batchTimer ??= setTimeout(
                        () => this.#flush(),
                        this.#batchWindowMs,
                    );
            });
        } finally {
            this.#release(lane);
        }
    }

    /** Send what has gathered: alone when it is one call, else as a batch. */
    #flush(): void {
        if (this.#batchTimer) clearTimeout(this.#batchTimer);
        this.#batchTimer = null;
        const batch = this.#batch;
        this.#batch = [];
        if (batch.length === 0) return;
        if (batch.some(({ call }) => call.beforeSend))
            void this.#sendStillCurrent(batch);
        else this.#sendGathered(batch);
    }

    #sendGathered(batch: BatchedCall[]): void {
        if (batch.length === 1 || Date.now() < this.#batchUnsupportedUntil) {
            for (const { call, resolve } of batch)
                void this.#sendOne(call).then(resolve);
            return;
        }
        void this.#sendBatch(batch);
    }

    /** Drops calls superseded while they were gathered, then sends the rest. */
    async #sendStillCurrent(batch: BatchedCall[]): Promise<void> {
        const checked = await Promise.all(
            batch.map(async (entry) => {
                if (!entry.call.beforeSend) return entry;
                try {
                    if (await entry.call.beforeSend()) return entry;
                    entry.resolve(supersededAnswer());
                } catch (err) {
                    entry.reject(err);
                }
                return null;
            }),
        );
        const current = checked.filter(
            (entry): entry is BatchedCall => entry !== null,
        );
        if (current.length > 0) this.#sendGathered(current);
    }

    /** One call on the single route. */
    async #sendOne(call: EventsInvokeCall): Promise<EventsInvokeAnswer> {
        try {
            const response = await this.#fetchImpl(
                `${this.#url}${EVENTS_DISPATCH_PATH}`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-puter-internal-auth': this.#secret,
                        'x-puter-events-script': call.script,
                        'x-puter-events-app': call.appUid,
                        ...(call.holder
                            ? { [EVENTS_HOLDER_HEADER]: call.holder }
                            : {}),
                        'x-puter-events-key': call.key,
                        ...(call.deployed
                            ? { [EVENTS_DEPLOYED_HEADER]: '1' }
                            : {}),
                    },
                    body: call.render ? call.render() : call.body,
                    signal: AbortSignal.timeout(call.timeoutMs),
                    dispatcher: this.#dispatcherFor(),
                },
            );
            // The body is not read: a handler answers with a status, and
            // whatever else it writes is its own business.
            void response.body?.cancel().catch(() => {});

            // The dispatcher never reached a handler, so its status is not the
            // delivery's answer.
            const dispatchError = response.headers.get(
                EVENTS_DISPATCH_ERROR_HEADER,
            );
            if (dispatchError !== null)
                return dispatchAnswer(dispatchError, response.status);

            return answerFrom(response);
        } catch (err) {
            return failedAnswer(err);
        }
    }

    /**
     * Several calls in one request. A call may wait in the dispatcher's queue
     * for whatever is left of its connection wait, and its timeout runs from
     * its `started` line; the request itself is dropped once every call has an
     * answer.
     */
    async #sendBatch(batch: BatchedCall[]): Promise<void> {
        const hangUp = new AbortController();
        let open = batch.length;
        const answered = batch.map(() => false);
        const timers: ReturnType<typeof setTimeout>[] = [];
        const finish = (i: number, done: (entry: BatchedCall) => void) => {
            if (answered[i]) return;
            answered[i] = true;
            clearTimeout(timers[i]);
            done(batch[i]);
            if (--open === 0) hangUp.abort();
        };
        const settle = (i: number, answer: EventsInvokeAnswer): void =>
            finish(i, (entry) => entry.resolve(answer));
        const settleRest = (answer: EventsInvokeAnswer): void => {
            for (let i = 0; i < batch.length; i++) settle(i, answer);
        };

        const now = Date.now();
        const waits = batch.map(({ call, waitingSince }) =>
            Math.max(
                0,
                Math.floor(
                    call.timeoutMs * CONNECTION_WAIT_SHARE -
                        (now - waitingSince),
                ),
            ),
        );
        const body = JSON.stringify({
            calls: batch.map(({ call }, i) => ({
                script: call.script,
                appUid: call.appUid,
                ...(call.holder ? { holder: call.holder } : {}),
                key: call.key,
                ...(call.deployed ? { deployed: true } : {}),
                body: call.render ? call.render() : call.body,
                waitMs: waits[i],
            })),
        });
        const arm = (
            i: number,
            ms: number,
            answer: () => EventsInvokeAnswer,
        ) => {
            clearTimeout(timers[i]);
            timers[i] = setTimeout(() => settle(i, answer()), ms);
            timers[i].unref?.();
        };
        // No `timedOut`: a call that never started never reached a handler.
        batch.forEach((_, i) =>
            arm(i, waits[i] + BATCH_START_GRACE_MS, () => ({
                status: null,
                error: 'dispatcher: call never started',
            })),
        );
        const started = (i: number): void => {
            if (!answered[i])
                arm(i, batch[i].call.timeoutMs, () =>
                    failedAnswer(timeoutError()),
                );
        };
        const longest = Math.max(
            ...batch.map(
                ({ call }, i) =>
                    waits[i] + BATCH_START_GRACE_MS + call.timeoutMs,
            ),
        );

        try {
            const response = await this.#fetchImpl(
                `${this.#url}${EVENTS_DISPATCH_BATCH_PATH}`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'x-puter-internal-auth': this.#secret,
                    },
                    body,
                    signal: AbortSignal.any([
                        hangUp.signal,
                        AbortSignal.timeout(longest),
                    ]),
                    dispatcher: this.#dispatcherFor(),
                },
            );

            const dispatchError = response.headers.get(
                EVENTS_DISPATCH_ERROR_HEADER,
            );
            if (dispatchError === 'no-such-route') {
                // A dispatcher from before the batch route: nothing ran, so
                // every call goes again on its own.
                void response.body?.cancel().catch(() => {});
                this.#batchUnsupportedUntil =
                    Date.now() + BATCH_UNSUPPORTED_RETRY_MS;
                batch.forEach(({ call }, i) => {
                    if (answered[i]) return;
                    const { beforeSend } = call;
                    if (!beforeSend) {
                        void this.#sendOne(call).then((a) => settle(i, a));
                        return;
                    }
                    // The batch round trip may have outlived the call.
                    void (async () => {
                        try {
                            if (!(await beforeSend()))
                                return settle(i, supersededAnswer());
                        } catch (err) {
                            return finish(i, (entry) => entry.reject(err));
                        }
                        settle(i, await this.#sendOne(call));
                    })();
                });
                return;
            }
            if (dispatchError !== null || !response.ok) {
                void response.body?.cancel().catch(() => {});
                // An unmarked failure (an edge 404, a WAF 403) reads as
                // Puter's, never as any handler's answer.
                settleRest(
                    dispatchError !== null
                        ? dispatchAnswer(dispatchError, response.status)
                        : {
                              status: null,
                              error: `dispatcher: unmarked ${response.status} for a batch`,
                          },
                );
                return;
            }

            let buffered = '';
            const read = (line: string): void => {
                if (line.trim() === '') return;
                const parsed = parseAnswerLine(line);
                if (!parsed || parsed.i >= batch.length) return;
                if ('started' in parsed) started(parsed.i);
                else settle(parsed.i, parsed.answer);
            };
            const decoder = new TextDecoder();
            for await (const chunk of response.body ?? []) {
                buffered += decoder.decode(chunk, { stream: true });
                let newline = buffered.indexOf('\n');
                while (newline !== -1) {
                    read(buffered.slice(0, newline));
                    buffered = buffered.slice(newline + 1);
                    newline = buffered.indexOf('\n');
                }
            }
            read(buffered);
            settleRest({
                status: null,
                error: 'dispatcher: batch ended without an answer',
            });
        } catch (err) {
            // Every call has its answer and the request was dropped on purpose.
            if (open === 0) return;
            settleRest(failedAnswer(err));
        }
    }

    /** Whether a call on `lane` may take a connection now. */
    #free(lane: InvokeLane): boolean {
        return (
            this.#active < INVOKE_CONNECTIONS &&
            (lane !== 'schedule' ||
                this.#scheduleActive < SCHEDULE_INVOKE_CONNECTIONS)
        );
    }

    #take(lane: InvokeLane): void {
        this.#active++;
        if (lane === 'schedule') this.#scheduleActive++;
    }

    /** A connection slot, or false once `waitMs` passes without one. */
    #acquire(waitMs: number, lane: InvokeLane): Promise<boolean> {
        if (this.#free(lane)) {
            this.#take(lane);
            return Promise.resolve(true);
        }
        return new Promise((resolve) => {
            const granted = () => {
                clearTimeout(timer);
                resolve(true);
            };
            const timer = setTimeout(() => {
                this.#waiting.delete(granted);
                resolve(false);
            }, waitMs);
            timer.unref?.();
            this.#waiting.set(granted, lane);
        });
    }

    /**
     * Give the slot back, then hand one to the longest waiter it can go to: a
     * schedule waiter at a full schedule share doesn't hold up a delivery.
     */
    #release(lane: InvokeLane): void {
        this.#active--;
        if (lane === 'schedule') this.#scheduleActive--;
        for (const [granted, waiting] of this.#waiting) {
            if (!this.#free(waiting)) continue;
            this.#waiting.delete(granted);
            this.#take(waiting);
            granted();
            return;
        }
    }

    /** One pool per process, built on first use and closed with the server. */
    #dispatcherFor(): Agent {
        this.#agent ??= new Agent({
            connections: INVOKE_CONNECTIONS,
            keepAliveTimeout: INVOKE_KEEP_ALIVE_MS,
            keepAliveMaxTimeout: INVOKE_KEEP_ALIVE_MS,
        });
        return this.#agent;
    }
}

/** What a failure the dispatcher marked as its own reads as. */
const dispatchAnswer = (
    reason: string,
    status: number,
): EventsInvokeAnswer => ({
    status: null,
    error: `dispatcher: ${reason} (${status})`,
    dispatchReason: reason,
});

/** What `AbortSignal.timeout` rejects with, for a batched call's own timeout. */
const timeoutError = (): Error =>
    new DOMException(
        'The operation was aborted due to timeout',
        'TimeoutError',
    );

/** One line of a batch answer, or null when it is not one. */
export const parseAnswerLine = (
    line: string,
):
    | { i: number; started: true }
    | { i: number; answer: EventsInvokeAnswer }
    | null => {
    let raw: unknown;
    try {
        raw = JSON.parse(line);
    } catch {
        return null;
    }
    if (!raw || typeof raw !== 'object') return null;
    const { i, started, status, handled, error, retryAfter, dispatch } =
        raw as Record<string, unknown>;
    if (!Number.isInteger(i) || (i as number) < 0) return null;
    if (started === true) return { i: i as number, started: true };
    if (typeof status !== 'number') return null;
    if (typeof dispatch === 'string')
        return { i: i as number, answer: dispatchAnswer(dispatch, status) };
    return {
        i: i as number,
        answer: answerFrom({
            status,
            headers: {
                get: (name) => {
                    if (name === EVENTS_HANDLED_HEADER)
                        return handled === true ? '1' : null;
                    if (name === EVENTS_ERROR_HEADER)
                        return typeof error === 'string' ? error : null;
                    if (name === 'retry-after')
                        return typeof retryAfter === 'string'
                            ? retryAfter
                            : null;
                    return null;
                },
            },
        }),
    };
};

/** Whether deploying the script is what fixes this answer. */
const selfDeployable = (result: EventsInvokeAnswer): boolean =>
    result.status === null
        ? result.dispatchReason !== undefined &&
          SELF_DEPLOYABLE_MISS_REASONS.has(result.dispatchReason)
        : result.handled === true && result.error === BAD_KEY_ERROR;

/** What a script's answer says, read the same way by every transport. */
export const answerFrom = (response: {
    status: number;
    headers: { get(name: string): string | null };
}): EventsInvokeAnswer => {
    const errorHeader = response.headers.get(EVENTS_ERROR_HEADER);
    const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
    return {
        status: response.status,
        handled: response.headers.get(EVENTS_HANDLED_HEADER) === '1',
        ...(errorHeader ? { error: errorHeader } : {}),
        ...(retryAfterMs ? { retryAfterMs } : {}),
    };
};

/** An attempt that threw before any answer came back. */
export const failedAnswer = (err: unknown): EventsInvokeAnswer => ({
    status: null,
    error: err instanceof Error ? err.message : String(err),
    // What `AbortSignal.timeout` rejects with.
    ...((err as { name?: unknown } | null)?.name === 'TimeoutError'
        ? { timedOut: true }
        : {}),
});

/** Whole seconds only; an HTTP-date form reads as absent. */
const parseRetryAfterMs = (value: string | null): number => {
    const seconds = Number(value);
    return value && Number.isFinite(seconds) && seconds > 0
        ? seconds * 1000
        : 0;
};

/**
 * 2xx took it regardless. Anything else not marked as the script's own answer
 * came from something between here and the handler. A marked answer is a
 * refusal when it is a 4xx other than 429, Puter's failure when the runtime
 * names one, and the handler's failure otherwise.
 */
export const outcomeForStatus = (
    status: number,
    handled: boolean,
    errorCode?: string,
): WorkerInvokeOutcome => {
    if (status >= 200 && status < 300) return 'settled';
    if (!handled) return 'unavailable';
    if (errorCode && PLATFORM_ERROR_CODES.has(errorCode)) return 'unavailable';
    if (status === 429) return 'retriable';
    if (status >= 400 && status < 500) return 'terminal';
    return 'retriable';
};
