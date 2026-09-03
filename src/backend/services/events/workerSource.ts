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
 * The generated file is not a program: it registers handlers into the events
 * runtime (`src/worker/src/events-runtime.js`), which is prepended at deploy
 * time and owns the single route an events worker answers. Handlers are baked
 * in at generation time, while a subscription's `context` stays on its row and
 * arrives with each invocation, so one worker serves every subscriber of the
 * app.
 */

/** First line of every generated worker, followed by the set hash. */
export const EVENTS_WORKER_MARKER = '// puter events worker';

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
            entries.push(`__puterEvents.markBroken(${key});`);
            continue;
        }
        // The trailing newline keeps a source ending in a line comment from
        // swallowing the closing parenthesis.
        entries.push(
            `__puterEvents.register(${key}, (\n${handler.source}\n));`,
        );
    }

    const source = `${EVENTS_WORKER_MARKER} ${setHash}
// Generated from this app's published handlers; republishing regenerates it.
${entries.join('\n')}
`;

    return { source, setHash, broken };
};
