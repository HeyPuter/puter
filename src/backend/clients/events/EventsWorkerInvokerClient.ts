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

/** How long a handler has to answer before the attempt is abandoned. */
export const EVENTS_INVOKE_TIMEOUT_MS = 30_000;

/**
 * Connections held open to the dispatcher, so a busy fleet is not
 * re-handshaking. The 30s invoke abort starts when a request is queued, not
 * when it gets a connection, so a saturated pool shows up as timeouts.
 */
const INVOKE_CONNECTIONS = 256;
const INVOKE_KEEP_ALIVE_MS = 30_000;

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
}

/**
 * Where an invocation is delivered.
 *
 * `status` is what the handler answered with. A `null` status means nothing
 * ran: no transport, no script, or a dispatcher that refused us — all of which
 * are the platform's fault and so retriable. `handled` is set only when the
 * answer is provably the script's own (the handled header); a 4xx without it
 * came from something between here and the script, not a handler's refusal.
 */
export interface EventsInvokeTransport {
    send(call: EventsInvokeCall): Promise<{
        status: number | null;
        handled?: boolean;
        error?: string;
    }>;
}

/**
 * What the call did.
 *
 * - `settled` — the handler took the delivery (2xx).
 * - `terminal` — it refused it (a marked 4xx). Retrying sends the same body to
 *   the same code, so it is not retried.
 * - `retriable` — it could not answer: 5xx, 429, a timeout, a transport failure,
 *   an unmarked 4xx (nothing said it was a handler's answer), or no way to
 *   reach the worker at all.
 */
export type WorkerInvokeOutcome = 'settled' | 'terminal' | 'retriable';

export interface WorkerInvokeResult {
    outcome: WorkerInvokeOutcome;
    /** The status the handler answered with, or `null` when it never did. */
    status: number | null;
    /** Why it could not answer, when nothing did. */
    error?: string;
}

const NO_TRANSPORT =
    'no events dispatcher configured (url and internal secret)';

export class EventsWorkerInvokerClient extends PuterClient {
    /** Set only where invocations do not leave the process — local development. */
    #transport: EventsInvokeTransport | null = null;
    #dispatcher: DispatcherInvokeTransport | null = null;

    /** Replaces the dispatcher with an in-process runtime. */
    setTransport(transport: EventsInvokeTransport): void {
        this.#transport = transport;
    }

    override onServerShutdown(): void {
        this.#dispatcher?.close();
        this.#dispatcher = null;
    }

    async invoke(request: WorkerInvokeRequest): Promise<WorkerInvokeResult> {
        const transport = this.#pickTransport();
        if (!transport)
            return { outcome: 'retriable', status: null, error: NO_TRANSPORT };

        const { status, handled, error } = await transport.send({
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
        });

        if (status === null)
            return { outcome: 'retriable', status: null, error };

        const outcome = outcomeForStatus(status, handled === true);
        // An unmarked 4xx (429 aside — that one is always retriable) is not
        // the handler's own answer; say so even when the transport did not,
        // so the reason a delivery kept retrying shows up in the log rather
        // than reading as an unexplained retry.
        const unmarkedFourxx =
            status !== 429 && status >= 400 && status < 500 && !handled;
        const reportedError =
            error ?? (unmarkedFourxx ? 'unmarked 4xx' : undefined);
        return {
            outcome,
            status,
            ...(reportedError ? { error: reportedError } : {}),
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

    async send(call: EventsInvokeCall): Promise<{
        status: number | null;
        handled?: boolean;
        error?: string;
    }> {
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
                };

            const handled = response.headers.get(EVENTS_HANDLED_HEADER) === '1';
            const errorHeader = response.headers.get(EVENTS_ERROR_HEADER);
            return {
                status: response.status,
                handled,
                ...(errorHeader ? { error: errorHeader } : {}),
            };
        } catch (err) {
            return {
                status: null,
                error: err instanceof Error ? err.message : String(err),
            };
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

/**
 * 2xx took it regardless. 429 is always "not now". Any other 4xx is a refusal
 * only when `handled` says the answer is provably the script's own — an
 * unmarked 4xx came from something between here and the handler.
 */
export const outcomeForStatus = (
    status: number,
    handled: boolean,
): WorkerInvokeOutcome => {
    if (status >= 200 && status < 300) return 'settled';
    if (status === 429) return 'retriable';
    if (status >= 400 && status < 500)
        return handled ? 'terminal' : 'retriable';
    return 'retriable';
};
