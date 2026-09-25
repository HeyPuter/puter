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
import { EVENTS_WORKER_SOURCE_MAX_BYTES } from '../../controllers/events/limits.js';
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

/**
 * Ceiling on the assembled file. A publish caps the handlers' own bytes at
 * `EVENTS_WORKER_SOURCE_MAX_BYTES`; the registration wrapper around each one is
 * this generator's, not the app's, so the margin is what keeps a set that
 * published legally from being undeployable for bytes it did not write.
 */
export const EVENTS_GENERATED_SOURCE_MAX_BYTES =
    EVENTS_WORKER_SOURCE_MAX_BYTES + 64 * 1024;

export interface GeneratedEventsWorker {
    source: string;
    /** Identity of the baked handler set; same handlers, same hash. */
    setHash: string;
    /** Names whose source does not parse as a function expression. */
    broken: string[];
    /** The set's generated source exceeds `EVENTS_GENERATED_SOURCE_MAX_BYTES`. */
    tooLarge: boolean;
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
 * What one handler's source registers as, once baked into the worker. The
 * newlines inside the parentheses are load-bearing: a source ending in a line
 * comment would otherwise swallow the closing parenthesis.
 */
const registerEntry = (name: string, source: string): string =>
    `__puterEvents.register(${JSON.stringify(name)}, (\n${source}\n));`;

/**
 * Whether a stored handler source parses as the exact text the worker will
 * carry, not some looser stand-in for it — a wrapping mismatch here is a
 * handler that looks fine alone and takes a SyntaxError into the generated
 * script, breaking every handler the app has. Construction only; nothing runs.
 */
const parsesAsHandlerEntry = (name: string, source: string): boolean => {
    try {
        new Function(registerEntry(name, source));
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
        if (!parsesAsHandlerEntry(handler.name, handler.source)) {
            broken.push(handler.name);
            entries.push(`__puterEvents.markBroken(${key});`);
            continue;
        }
        entries.push(registerEntry(handler.name, handler.source));
    }

    const source = `${EVENTS_WORKER_MARKER} ${setHash}
// Generated from this app's published handlers; republishing regenerates it.
${entries.join('\n')}
`;

    // Every entry parsed alone, but only the assembled file is what actually
    // gets deployed. One last compile catches anything the per-handler check
    // could not — and if the file itself will not parse, there is no handler
    // left to trust: mark the whole set broken rather than ship it.
    try {
        new Function(source);
        return {
            source,
            setHash,
            broken,
            tooLarge:
                Buffer.byteLength(source, 'utf8') >
                EVENTS_GENERATED_SOURCE_MAX_BYTES,
        };
    } catch {
        const allBroken = sorted.map((handler) => handler.name);
        const fallbackSource = `${EVENTS_WORKER_MARKER} ${setHash}
// Generated from this app's published handlers; republishing regenerates it.
// The assembled script would not parse, so every handler was marked broken.
${allBroken.map((name) => `__puterEvents.markBroken(${JSON.stringify(name)});`).join('\n')}
`;
        return {
            source: fallbackSource,
            setHash,
            broken: allBroken,
            tooLarge:
                Buffer.byteLength(fallbackSource, 'utf8') >
                EVENTS_GENERATED_SOURCE_MAX_BYTES,
        };
    }
};
