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

import { createHash } from 'node:crypto';
import type { EventHandler } from '../../stores/events/EventHandlerStore.js';

/**
 * Turns an app's published handlers into the source of its events worker.
 *
 * The worker is a platform artifact: it reserves exactly one route, `POST
 * /__events/invoke`, and registers nothing else. Handlers are baked in at
 * generation time — publishing is what deploys — while a subscription's
 * `context` stays on its row and arrives with each invocation, so one worker
 * serves every subscriber of the app.
 *
 * What an invocation answers with is the whole protocol:
 *
 * - 2xx — the handler took the delivery (resolved, or called `ack()`).
 * - 404 — no handler by that name; terminal, the same body cannot do better.
 * - 400 — the body was not a delivery, or the handler refused it by throwing an
 *   error marked terminal (`terminal: true` or `code: 'events_terminal'`).
 * - 401 — no `puter-auth` token, so there is nothing to run the handler as.
 * - 500 — the handler threw; retriable, the next attempt may do better.
 */

/** First line of every generated worker, followed by the set hash. */
export const EVENTS_WORKER_MARKER = '// puter events worker';

/** Generated source files are named `<prefix><setHash16>.js`. */
export const EVENTS_WORKER_FILE_PREFIX = 'events-worker-';

export interface GeneratedEventsWorker {
    source: string;
    /** Identity of the baked handler set; same handlers, same hash. */
    setHash: string;
    /** Names whose source does not parse as a function expression. */
    broken: string[];
}

/**
 * Identity of a handler set: which names are published and with what source.
 * What the deploy step's idempotence keys on, upstream of any deploy backend.
 */
export const handlerSetHash = (
    handlers: readonly Pick<EventHandler, 'name' | 'sourceHash'>[],
): string => {
    const pairs = handlers
        .map(({ name, sourceHash }) => [name, sourceHash])
        .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    return createHash('sha256')
        .update(JSON.stringify(pairs), 'utf8')
        .digest('hex');
};

/**
 * Whether a stored handler source can be embedded as a function expression.
 * Construction only — nothing runs. The store accepts any string, and one
 * unparseable handler must not take the app's other handlers down with it.
 */
const parsesAsFunction = (source: string): boolean => {
    try {
        new Function(`return (\n${source}\n);`);
        return true;
    } catch {
        return false;
    }
};

export const generateEventsWorkerSource = (
    handlers: readonly EventHandler[],
): GeneratedEventsWorker => {
    const sorted = [...handlers].sort((a, b) => (a.name < b.name ? -1 : 1));
    const setHash = handlerSetHash(sorted);
    const broken: string[] = [];

    const entries: string[] = [];
    for (const handler of sorted) {
        const key = JSON.stringify(handler.name);
        if (!parsesAsFunction(handler.source)) {
            broken.push(handler.name);
            entries.push(`    broken[${key}] = true;`);
            continue;
        }
        // The trailing newline keeps a source ending in a line comment from
        // swallowing the closing parenthesis.
        entries.push(`    handlers[${key}] = (\n${handler.source}\n    );`);
    }

    const source = `${EVENTS_WORKER_MARKER} ${setHash}
// Generated from this app's published handlers; republishing regenerates it.
// The one route below is reserved for event delivery — nothing else answers.
(() => {
    'use strict';
    const handlers = Object.create(null);
    const broken = Object.create(null);

${entries.join('\n')}

    const answer = (status, body) => new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

    router.post('/__events/invoke', async (event) => {
        // The router builds \`event.user.puter\` from the \`puter-auth\`
        // header; a call without the delivery token has nothing to run as.
        if (!event.user || !event.user.puter) {
            return answer(401, { error: 'missing delivery token' });
        }

        let body = null;
        try { body = await event.request.json(); } catch { /* answered below */ }
        if (!body || typeof body !== 'object') {
            return answer(400, { error: 'body must be a JSON object' });
        }

        const name = typeof body.handler === 'string' ? body.handler : '';
        // Published but not runnable: retriable, so republishing a fixed
        // source is picked up rather than the delivery being dropped.
        if (broken[name]) return answer(500, { error: 'handler failed to load' });
        const run = handlers[name];
        if (!run) return answer(404, { error: 'unknown handler' });

        // \`ack()\` marks the delivery taken; a later throw does not unsay it.
        let acked = false;
        const ack = () => { acked = true; return Promise.resolve(); };
        const ctx = Object.freeze(body.ctx === null || body.ctx === undefined ? {} : body.ctx);

        try {
            await run({
                event: body.event,
                ctx,
                user: event.user.puter,
                fetch: globalThis.fetch.bind(globalThis),
                ack,
            });
            return answer(200, { ok: true });
        } catch (err) {
            if (acked) return answer(200, { ok: true });
            const terminal = !!err &&
                (err.terminal === true || err.code === 'events_terminal');
            const message = err && err.message ? String(err.message) : String(err);
            return answer(terminal ? 400 : 500, { error: message });
        }
    });
})();
`;

    return { source, setHash, broken };
};
