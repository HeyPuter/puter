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
 *     x-puter-events-key:     <key derived for that script>
 *     { handler, event, ctx, token }
 *
 * The delivery token rides in the body, not a header, so nothing between here
 * and the isolate can treat it as its own authorization.
 *
 * On a miss, a handler set here may deploy the script itself and retry once
 * with `x-puter-events-deployed: 1`, skipping the dispatcher's own callback.
 */

/** The one route an events worker answers. */
export const EVENTS_INVOKE_PATH = '/__events/invoke';

/** The route the events dispatcher takes an invocation on. */
export const EVENTS_DISPATCH_PATH = '/invoke';

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

/** What a self-deploy attempt did, and to which app/script it applies. */
export type WorkerMissHandler = (
    appUid: string,
    script: string,
) => Promise<'deployed' | string>;

/** How long a handler has to answer before the attempt is abandoned. */
export const EVENTS_INVOKE_TIMEOUT_MS = 30_000;

/**
 * Connections held open to the dispatcher, so a busy fleet is not
 * re-handshaking. Also how many calls one transport makes at once: a call past
 * that waits for a free one before its invoke timeout starts.
 */
export const INVOKE_CONNECTIONS = 256;
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
    /** Value the script compares against its own invoke-key binding. */
    key: string;
    /** Serialized `{ handler, event, ctx, token }`. */
    body: string;
    timeoutMs: number;
    /** Set on the retry after this backend deployed the script itself. */
    deployed?: boolean;
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
    /** The status the handler answered with, or `null` when it never did. */
    status: number | null;
    /** Why it could not answer, when nothing did. */
    error?: string;
    /** How long the answer asked to be left alone. */
    retryAfterMs?: number;
}

const NO_TRANSPORT =
    'no events dispatcher configured (url and internal secret)';

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

    async invoke(request: WorkerInvokeRequest): Promise<WorkerInvokeResult> {
        const transport = this.#pickTransport();
        if (!transport)
            return {
                outcome: 'unavailable',
                status: null,
                error: NO_TRANSPORT,
            };

        const call: EventsInvokeCall = {
            script: request.script,
            appUid: request.appUid,
            key: request.key,
            body: JSON.stringify({
                handler: request.handler,
                event: request.event,
                ctx: request.ctx,
                token: request.token,
            }),
            timeoutMs: this.#timeoutMs(),
        };

        let result = await transport.send(call);
        if (this.#missHandler && selfDeployable(result)) {
            const outcome = await this.#missHandler(
                request.appUid,
                request.script,
            );
            if (outcome !== 'deployed')
                return {
                    outcome: 'unavailable',
                    status: null,
                    error: `deploy: ${outcome}`,
                };
            result = await transport.send({ ...call, deployed: true });
        } else if (
            result.status === null &&
            result.dispatchReason &&
            ALREADY_DEPLOYED_MISS_REASONS.has(result.dispatchReason)
        ) {
            // No deploy to trigger — just give propagation the one retry
            // it usually needs, without spending an upload on it.
            result = await transport.send({ ...call, deployed: true });
        }

        const { status, handled, error, timedOut, retryAfterMs } = result;
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
        this.#dispatcher ??= new DispatcherInvokeTransport(
            dispatcherUrl,
            internalSecret,
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

/** Reaches an events worker the only way production can: through the dispatcher. */
export class DispatcherInvokeTransport implements EventsInvokeTransport {
    readonly #url: string;
    readonly #secret: string;
    readonly #fetchImpl: typeof undiciFetch;
    #agent: Agent | null = null;
    /** Calls holding a connection slot. */
    #active = 0;
    /** Calls waiting for one, longest-waiting first. */
    readonly #waiting = new Set<() => void>();

    constructor(
        dispatcherUrl: string,
        secret: string,
        options: { fetchImpl?: typeof undiciFetch } = {},
    ) {
        this.#url = dispatcherUrl;
        this.#secret = secret;
        this.#fetchImpl = options.fetchImpl ?? undiciFetch;
    }

    close(): void {
        void this.#agent?.close().catch(() => {});
        this.#agent = null;
    }

    async send(call: EventsInvokeCall): Promise<EventsInvokeAnswer> {
        // No `timedOut`: the handler never got this call, so the wait is not
        // its failure.
        if (!(await this.#acquire(call.timeoutMs * CONNECTION_WAIT_SHARE)))
            return {
                status: null,
                error: 'no free connection to the events dispatcher',
            };
        try {
            // `new URL(path, base)` resolves an absolute path against the
            // base's origin, dropping any path prefix `base` already carries.
            const url = `${this.#url.replace(/\/$/, '')}${EVENTS_DISPATCH_PATH}`;
            const response = await this.#fetchImpl(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-puter-internal-auth': this.#secret,
                    'x-puter-events-script': call.script,
                    'x-puter-events-app': call.appUid,
                    'x-puter-events-key': call.key,
                    ...(call.deployed ? { [EVENTS_DEPLOYED_HEADER]: '1' } : {}),
                },
                body: call.body,
                signal: AbortSignal.timeout(call.timeoutMs),
                dispatcher: this.#dispatcherFor(),
            });
            // The body is not read: a handler answers with a status, and
            // whatever else it writes is its own business.
            void response.body?.cancel().catch(() => {});

            // The dispatcher never reached a handler, so its status is not the
            // delivery's answer.
            const dispatchError = response.headers.get(
                EVENTS_DISPATCH_ERROR_HEADER,
            );
            if (dispatchError !== null)
                return {
                    status: null,
                    error: `dispatcher: ${dispatchError} (${response.status})`,
                    dispatchReason: dispatchError,
                };

            return answerFrom(response);
        } catch (err) {
            return failedAnswer(err);
        } finally {
            this.#release();
        }
    }

    /** A connection slot, or false once `waitMs` passes without one. */
    #acquire(waitMs: number): Promise<boolean> {
        if (this.#active < INVOKE_CONNECTIONS) {
            this.#active++;
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
            this.#waiting.add(granted);
        });
    }

    /** Hand the slot to the longest waiter, or give it back. */
    #release(): void {
        const next = this.#waiting.values().next().value;
        if (next) {
            this.#waiting.delete(next);
            next();
            return;
        }
        this.#active--;
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
