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
 * The protocol is fixed and lives here rather than in the events service
 * because it is a wire format, not a delivery decision: one POST, one header,
 * and a status code that says whether the handler took the delivery, refused
 * it, or could not answer.
 *
 *     POST <events worker>/__events/invoke
 *     puter-auth: <subscriber-scoped access token>
 *     { handler, event, ctx }
 *
 * The token is minted above this layer and passed in: what a delivery is
 * allowed to do is an authorization question, and this only carries the
 * answer.
 */

/** The one route an events worker reserves for the platform. */
export const EVENTS_INVOKE_PATH = '/__events/invoke';

/** How long a handler has to answer before the attempt is abandoned. */
export const EVENTS_INVOKE_TIMEOUT_MS = 30_000;

/** Connections held open per worker host, so a busy app is not re-handshaking. */
const INVOKE_CONNECTIONS = 64;
const INVOKE_KEEP_ALIVE_MS = 30_000;

/**
 * Where an app's events worker can be reached.
 *
 * Building and deploying that worker is a separate concern, so this is a seam:
 * the default resolves nothing, and the deployment that owns worker addressing
 * registers an implementation. A `null` answer means the app has no events
 * worker to invoke.
 */
export interface EventsWorkerResolver {
    resolveInvokeUrl(appUid: string): Promise<string | null>;
}

/** The stand-in until something can address an app's events worker. */
export class UnresolvedEventsWorkerResolver implements EventsWorkerResolver {
    resolveInvokeUrl(): Promise<string | null> {
        return Promise.resolve(null);
    }
}

/**
 * What the call did.
 *
 * - `settled` — the handler took the delivery (2xx).
 * - `terminal` — it refused it (4xx). Retrying sends the same body to the same
 *   code, so it is not retried.
 * - `retriable` — it could not answer: 5xx, 429, a timeout, a transport failure,
 *   or no worker to address at all.
 */
export type WorkerInvokeOutcome = 'settled' | 'terminal' | 'retriable';

export interface WorkerInvokeRequest {
    appUid: string;
    handler: string;
    /** Subscriber-scoped access token, sent in `puter-auth`. */
    token: string;
    event: unknown;
    ctx: unknown;
}

export interface WorkerInvokeResult {
    outcome: WorkerInvokeOutcome;
    /** The status the handler answered with, or `null` when it never did. */
    status: number | null;
    /** Why it could not answer, when nothing did. */
    error?: string;
}

const RESOLVER_UNAVAILABLE = 'no events worker is deployed for this app';

export class EventsWorkerInvokerClient extends PuterClient {
    /** Replaced by whatever owns worker addressing on this deployment. */
    #resolver: EventsWorkerResolver = new UnresolvedEventsWorkerResolver();
    #agent: Agent | null = null;

    setResolver(resolver: EventsWorkerResolver): void {
        this.#resolver = resolver;
    }

    override onServerShutdown(): void {
        void this.#agent?.close().catch(() => {});
        this.#agent = null;
    }

    async invoke(request: WorkerInvokeRequest): Promise<WorkerInvokeResult> {
        let url: string | null = null;
        try {
            url = await this.#resolver.resolveInvokeUrl(request.appUid);
        } catch (err) {
            return {
                outcome: 'retriable',
                status: null,
                error: err instanceof Error ? err.message : String(err),
            };
        }
        // Nothing to call yet. Retriable rather than terminal: the address is
        // the platform's to provide, and an app whose worker is not there has
        // done nothing wrong — the consecutive-failure rule is what stops this
        // from retrying forever.
        if (!url)
            return {
                outcome: 'retriable',
                status: null,
                error: RESOLVER_UNAVAILABLE,
            };

        try {
            const response = await undiciFetch(
                new URL(EVENTS_INVOKE_PATH, url).toString(),
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        'puter-auth': request.token,
                    },
                    body: JSON.stringify({
                        handler: request.handler,
                        event: request.event,
                        ctx: request.ctx,
                    }),
                    signal: AbortSignal.timeout(this.#timeoutMs()),
                    dispatcher: this.#dispatcher(),
                },
            );
            // The body is not read: a handler answers with a status, and
            // whatever else it writes is its own business.
            void response.body?.cancel().catch(() => {});
            return {
                outcome: outcomeForStatus(response.status),
                status: response.status,
            };
        } catch (err) {
            return {
                outcome: 'retriable',
                status: null,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }

    #timeoutMs(): number {
        const configured = this.config.events?.invokeTimeoutMs;
        return typeof configured === 'number' && configured > 0
            ? configured
            : EVENTS_INVOKE_TIMEOUT_MS;
    }

    /** One pool per process, built on first use and closed with the server. */
    #dispatcher(): Agent {
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
