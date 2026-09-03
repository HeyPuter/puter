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
 * Events workers are not addressable from the internet: they are deployed into
 * their own dispatch namespace, which the public worker dispatcher does not
 * serve, and reached only through the events dispatcher — a worker with no zone
 * route that answers on its own hostname and requires the internal secret.
 *
 *     POST <events dispatcher>/invoke
 *     x-puter-internal-auth:  <internal secret>
 *     x-puter-events-script:  <script the handler set deploys as>
 *     x-puter-events-app:     <app uid, for the deploy-on-miss callback>
 *     x-puter-events-key:     <key derived for that script>
 *     { handler, event, ctx, token }
 *
 * The delivery token rides in the body rather than a header so nothing between
 * here and the isolate treats it as its own authorization. What it is allowed
 * to do is decided above this layer; this only carries the answer.
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

/** How long a handler has to answer before the attempt is abandoned. */
export const EVENTS_INVOKE_TIMEOUT_MS = 30_000;

/**
 * Connections held open to the dispatcher, so a busy fleet is not
 * re-handshaking.
 */
const INVOKE_CONNECTIONS = 64;
const INVOKE_KEEP_ALIVE_MS = 30_000;

/** One invocation, as the events service hands it over. */
export interface WorkerInvokeRequest {
    /** Script the app's current handler set deploys as. */
    script: string;
    appUid: string;
    handler: string;
    /** Subscriber-scoped access token the handler runs as. */
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
 * are the platform's fault and so retriable.
 */
export interface EventsInvokeTransport {
    send(call: EventsInvokeCall): Promise<{
        status: number | null;
        error?: string;
    }>;
}

/**
 * What the call did.
 *
 * - `settled` — the handler took the delivery (2xx).
 * - `terminal` — it refused it (4xx). Retrying sends the same body to the same
 *   code, so it is not retried.
 * - `retriable` — it could not answer: 5xx, 429, a timeout, a transport failure,
 *   or no way to reach the worker at all.
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

        const { status, error } = await transport.send({
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
        return { outcome: outcomeForStatus(status), status };
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
    #agent: Agent | null = null;

    constructor(dispatcherUrl: string, secret: string) {
        this.#url = dispatcherUrl;
        this.#secret = secret;
    }

    close(): void {
        void this.#agent?.close().catch(() => {});
        this.#agent = null;
    }

    async send(call: EventsInvokeCall): Promise<{
        status: number | null;
        error?: string;
    }> {
        try {
            const response = await undiciFetch(
                new URL(EVENTS_DISPATCH_PATH, this.#url).toString(),
                {
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
                return {
                    status: null,
                    error: `dispatcher: ${dispatchError} (${response.status})`,
                };

            return { status: response.status };
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

/** 2xx took it, 429 is "not now", any other 4xx is a refusal. */
export const outcomeForStatus = (status: number): WorkerInvokeOutcome => {
    if (status >= 200 && status < 300) return 'settled';
    if (status === 429) return 'retriable';
    if (status >= 400 && status < 500) return 'terminal';
    return 'retriable';
};
