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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Seeded fuzzing helpers for the AI drivers: a replayable random source, JSON
 * values that parsers tend to mishandle, mutation of a valid request, and a
 * stand-in for every outbound HTTP client the providers use.
 */

import https from 'node:https';

import { translateProviderError } from '../../../controllers/drivers/DriverController.js';
import { isHttpError } from '../../../core/http/HttpError.js';

export type Random = () => number;

/** The same sequence for the same seed, so a failing case can be replayed. */
export const seededRandom = (seed: number): Random => {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

/** A case's own sequence, so a case does not depend on the ones before it. */
export const caseRandom = (seed: number, index: number): Random =>
    seededRandom(Math.imul(seed ^ index, 0x9e3779b1));

export const pick = <T>(random: Random, values: readonly T[]): T =>
    values[Math.floor(random() * values.length)]!;

/**
 * Picks by rendezvous hashing: a value added to or removed from `values` moves
 * only the cases it wins, so a catalog change leaves every other case alone.
 */
export const pickStable = <T>(
    random: Random,
    values: readonly T[],
    key: (value: T) => string,
): T => {
    const salt = (random() * 0x100000000) >>> 0;
    let best = values[0]!;
    let bestScore = -1;
    for (const value of values) {
        let hash = salt;
        for (const char of key(value)) {
            hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193);
        }
        hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
        hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
        const score = (hash ^ (hash >>> 16)) >>> 0;
        if (score > bestScore) {
            best = value;
            bestScore = score;
        }
    }
    return best;
};

const STRINGS = [
    '',
    ' ',
    'a',
    '0',
    '-1',
    '1e309',
    'null',
    'true',
    '[',
    '{"a":1}',
    '__proto__',
    'constructor',
    'toString',
    'hasOwnProperty',
    '\u0000',
    '\ud800',
    '\u{1f600}'.repeat(3),
    'a'.repeat(5000),
    'data:,',
    'data:image/png;base64,',
    'data:image/png;base64,AAAA',
    'data:text/plain,hi',
    'http://localhost/x',
    'http://169.254.169.254/latest',
    'file:///etc/passwd',
    'https://upstream.test/a.png',
    '/etc/passwd',
    '~/file.txt',
    '../../x',
];

const NUMBERS = [
    0,
    1,
    -1,
    0.5,
    1e-9,
    2 ** 31,
    2 ** 53,
    -(2 ** 53),
    1e308,
    -1e308,
];

const KEYS = [
    'type',
    'role',
    'content',
    'text',
    'id',
    'name',
    'url',
    'data',
    'length',
    'toString',
    'constructor',
    '__proto__',
    'then',
    '0',
    '',
];

// `__proto__` has to land as an own key, the way `JSON.parse` leaves it.
const setOwn = (target: object, key: string, value: unknown): void => {
    Object.defineProperty(target, key, {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
    });
};

/** A value JSON can carry that parsers tend to mishandle. */
export const hostileValue = (random: Random, depth = 0): unknown => {
    const roll = Math.floor(random() * (depth > 3 ? 5 : 8));
    if (roll === 0) return null;
    if (roll === 1) return random() < 0.5;
    if (roll === 2) return pick(random, NUMBERS);
    if (roll <= 4) return pick(random, STRINGS);
    if (roll === 5) {
        return Array.from({ length: Math.floor(random() * 4) }, () =>
            hostileValue(random, depth + 1),
        );
    }
    const object = {};
    for (let count = Math.floor(random() * 4); count > 0; count--) {
        setOwn(object, pick(random, KEYS), hostileValue(random, depth + 1));
    }
    return object;
};

type Container = Record<string, unknown> | unknown[];
type Slot = { parent: Container; key: string | number };

const isContainer = (value: unknown): value is Container =>
    typeof value === 'object' && value !== null;

const slotsOf = (root: Container): Slot[] => {
    const slots: Slot[] = [];
    const walk = (parent: Container) => {
        const keys = Array.isArray(parent)
            ? parent.map((_, index) => index)
            : Object.keys(parent);
        for (const key of keys) {
            slots.push({ parent, key });
            const child = (parent as Record<string | number, unknown>)[key];
            if (isContainer(child)) walk(child);
        }
    };
    walk(root);
    return slots;
};

const read = ({ parent, key }: Slot): unknown =>
    (parent as Record<string | number, unknown>)[key];

const write = ({ parent, key }: Slot, value: unknown): void => {
    if (Array.isArray(parent)) parent[key as number] = value;
    else setOwn(parent, key as string, value);
};

const retyped = (value: unknown, random: Random): unknown => {
    const forms: (() => unknown)[] = [
        () => [value],
        () => ({ value }),
        () =>
            typeof value === 'string' ? value.length : JSON.stringify(value),
        () => null,
        () => !value,
    ];
    return pick(random, forms)();
};

/**
 * Returns a copy of `base` with a few places changed, usually one or two: a
 * value replaced by a hostile one, by another type, or by a value from
 * elsewhere in the request, or a key removed, repeated or added.
 */
export const mutate = <T extends Container>(
    base: T,
    random: Random,
    extraKeys: readonly string[] = [],
): T => {
    const root = structuredClone(base);
    const changes = 1 + Math.floor(random() * random() * 8);
    for (let count = changes; count > 0; count--) {
        const slots = slotsOf(root);
        if (!slots.length) break;
        const slot = pick(random, slots);
        const { parent, key } = slot;
        const roll = Math.floor(random() * 7);
        if (roll === 0) write(slot, hostileValue(random));
        else if (roll === 1) write(slot, retyped(read(slot), random));
        else if (roll === 2) {
            // A value from another place: valid in itself, wrong here.
            write(slot, structuredClone(read(pick(random, slots))));
        } else if (roll === 3) {
            if (Array.isArray(parent)) parent.splice(key as number, 1);
            else delete parent[key];
        } else if (roll === 4 && Array.isArray(parent)) {
            parent.splice(key as number, 0, structuredClone(read(slot)));
        } else if (roll === 5) {
            const strings = slots
                .map(read)
                .filter((v) => typeof v === 'string');
            if (strings.length) write(slot, pick(random, strings));
        } else {
            const target = isContainer(read(slot)) ? read(slot) : parent;
            if (Array.isArray(target)) target.push(hostileValue(random));
            else {
                const names = [...extraKeys, ...Object.keys(root), ...KEYS];
                setOwn(
                    target as object,
                    pick(random, names),
                    random() < 0.5
                        ? hostileValue(random)
                        : structuredClone(read(pick(random, slots))),
                );
            }
        }
    }
    return root;
};

/** Case count for a fuzz loop. `PUTER_FUZZ_CASES` raises it for a longer hunt. */
export const fuzzCases = (count: number): number => {
    const override = Number(process.env.PUTER_FUZZ_CASES);
    return Number.isInteger(override) && override > 0 ? override : count;
};

/** Groups fuzz failures by signature, so one defect reads as one finding. */
export class Findings {
    #bySignature = new Map<string, { count: number; first: string }>();

    add(signature: string, index: number, label: string, input: unknown): void {
        const known = this.#bySignature.get(signature);
        if (known) known.count++;
        else {
            this.#bySignature.set(signature, {
                count: 1,
                first: `case ${index} ${label} ${JSON.stringify(input).slice(0, 700)}`,
            });
        }
    }

    assertNone(): void {
        if (!this.#bySignature.size) return;
        const lines = [...this.#bySignature].map(
            ([signature, { count, first }]) =>
                `${count}x ${signature}\n    ${first}`,
        );
        throw new Error(
            `${lines.length} fuzz finding(s):\n${lines.join('\n')}`,
        );
    }
}

const CASE_TIMEOUT_MS = 10_000;

/**
 * Calls `call` with `cases` mutated requests from `corpus` and collects every
 * call that fails with an unclassified error or does not finish.
 */
export const fuzzCalls = async (options: {
    seed: number;
    cases: number;
    corpus: readonly Record<string, unknown>[];
    optionNames?: readonly string[];
    /** Fields set after mutation, such as the route under test. */
    pinned?: (random: Random) => Record<string, unknown>;
    call: (args: Record<string, unknown>) => Promise<unknown>;
}): Promise<Findings> => {
    const findings = new Findings();
    for (let index = 0; index < options.cases; index++) {
        const random = caseRandom(options.seed, index);
        const args = {
            ...mutate(
                pick(random, options.corpus),
                random,
                options.optionNames,
            ),
            ...options.pinned?.(random),
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await Promise.race([
                options.call(structuredClone(args)),
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error('the call did not finish')),
                        CASE_TIMEOUT_MS,
                    );
                }),
            ]);
        } catch (error) {
            const unclassified = unclassifiedFailure(error);
            if (unclassified) findings.add(unclassified, index, '', args);
        } finally {
            clearTimeout(timer);
        }
    }
    return findings;
};

/**
 * The failure as `/drivers/call` would report it, or undefined when it is
 * classified.
 */
export const unclassifiedFailure = (error: unknown): string | undefined => {
    const translated = translateProviderError(error);
    if (isHttpError(translated)) return undefined;
    const e = error as { name?: string; message?: string; stack?: string };
    const where = e?.stack?.split('\n').find((line) => line.includes('/src/'));
    return `${e?.name ?? typeof error}: ${String(e?.message ?? error).slice(0, 200)}${where ? ` ${where.trim()}` : ''}`;
};

export interface UpstreamRequest {
    url: URL;
    method: string;
    /** The parsed JSON body, when there is one. */
    json: unknown;
}

export interface UpstreamReply {
    status?: number;
    /** An object is sent as JSON, a string as text. */
    body?: unknown;
    /** Sent as a server-sent event stream; an entry with `event` names it. */
    sse?: { event?: string; data: unknown }[];
    contentType?: string;
}

const ERROR_STATUSES = [400, 401, 403, 404, 408, 409, 422, 429, 500, 503, 529];

/**
 * A reply the vendor should not have sent: a wrong status, a body that is not
 * the documented shape or not JSON at all, or an event stream with events
 * changed, repeated, dropped or cut short.
 */
export const corruptReply = (
    reply: UpstreamReply,
    random: Random,
): UpstreamReply => {
    const status =
        random() < 0.15 ? pick(random, ERROR_STATUSES) : reply.status;
    if (reply.sse) {
        const events = reply.sse.flatMap((event) => {
            const roll = random();
            if (roll < 0.1) return [];
            if (roll < 0.2) return [event, event];
            if (roll < 0.3) return [{ ...event, data: hostileValue(random) }];
            if (roll < 0.6 && isContainer(event.data)) {
                return [{ ...event, data: mutate(event.data, random) }];
            }
            return [event];
        });
        const kept =
            random() < 0.2
                ? Math.floor(random() * events.length)
                : events.length;
        return { ...reply, status, sse: events.slice(0, kept) };
    }
    const roll = random();
    if (roll < 0.1)
        return {
            status,
            body: pick(random, ['', '<html>Bad gateway</html>', '{', 'null']),
        };
    if (roll < 0.25) return { ...reply, status, body: hostileValue(random) };
    if (isContainer(reply.body)) {
        return { ...reply, status, body: mutate(reply.body, random) };
    }
    return { ...reply, status };
};

const realFetch = globalThis.fetch;
const realHttpsRequest = https.request;

const requestUrl = (input: unknown): string =>
    typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;

const parseJson = (text: unknown): unknown => {
    if (typeof text !== 'string') return undefined;
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
};

/**
 * Answers every outbound request in place of the network. A suite installs
 * `fetch` over the global and undici `fetch`, `axios` over the axios calls, and
 * sets `respond` to play the upstream.
 */
export const upstream = {
    /** Returns the reply for a request, or undefined to refuse it. */
    respond: (_request: UpstreamRequest): UpstreamReply | undefined =>
        undefined,

    /** Requests `respond` had no reply for. */
    unanswered: new Set<string>(),

    /** How many requests reached `respond`. */
    asked: 0,

    /**
     * Routes global `fetch` here and makes `https.request` throw, so an SDK
     * with its own client fails the suite instead of calling its vendor.
     */
    install(): void {
        globalThis.fetch = upstream.fetch as typeof fetch;
        https.request = ((...args: unknown[]) => {
            const target = args[0] as { host?: string; hostname?: string };
            throw new Error(
                `fuzz suite reached the network: ${target?.hostname ?? target?.host ?? String(args[0])}`,
            );
        }) as typeof https.request;
    },

    uninstall(): void {
        globalThis.fetch = realFetch;
        https.request = realHttpsRequest;
    },

    async fetch(input: unknown, init?: RequestInit): Promise<Response> {
        const href = requestUrl(input);
        if (href.startsWith('data:')) return realFetch(href, init);
        init?.signal?.throwIfAborted();
        const url = new URL(href);
        const method = (
            init?.method ??
            (input as Request).method ??
            'GET'
        ).toUpperCase();
        const text =
            init?.body ??
            (input instanceof Request ? await input.clone().text() : undefined);
        upstream.asked++;
        const reply = upstream.respond({ url, method, json: parseJson(text) });
        // Stainless SDKs sleep between retries unless told not to.
        const headers: Record<string, string> = { 'x-should-retry': 'false' };
        if (!reply) {
            upstream.unanswered.add(`${method} ${url.origin}${url.pathname}`);
            return Response.json(
                { error: { message: 'no upstream fixture' } },
                { status: 404, headers },
            );
        }
        const status = reply.status ?? 200;
        if (reply.sse) {
            const frames = reply.sse.map(
                ({ event, data }) =>
                    `${event ? `event: ${event}\n` : ''}data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`,
            );
            return new Response(frames.join(''), {
                status,
                headers: {
                    ...headers,
                    'content-type': reply.contentType ?? 'text/event-stream',
                },
            });
        }
        const plain =
            typeof reply.body === 'string'
                ? reply.body
                : reply.body === undefined
                  ? ''
                  : undefined;
        if (plain !== undefined) {
            return new Response(plain, {
                status,
                headers: {
                    ...headers,
                    'content-type': reply.contentType ?? 'text/plain',
                },
            });
        }
        return new Response(JSON.stringify(reply.body), {
            status,
            headers: {
                ...headers,
                'content-type': reply.contentType ?? 'application/json',
            },
        });
    },

    async axios(config: {
        url?: string;
        method?: string;
        data?: unknown;
    }): Promise<{ status: number; data: unknown }> {
        upstream.asked++;
        const reply = upstream.respond({
            url: new URL(config.url ?? 'http://unknown.test'),
            method: (config.method ?? 'GET').toUpperCase(),
            json: config.data,
        });
        if (!reply || (reply.status ?? 200) >= 400) {
            throw Object.assign(new Error('upstream unreachable'), {
                code: 'ECONNREFUSED',
            });
        }
        return { status: reply.status ?? 200, data: reply.body };
    },
};
