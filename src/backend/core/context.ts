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

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { Actor } from './actor';

/**
 * Per-request context with both typed well-known fields AND an open-ended
 * key-value map for ad-hoc data. Common fields (`actor`, `req`) are typed for
 * autocomplete / safety, while the generic `get`/`set` bag lets any code stash
 * per-request values without threading them through function arguments.
 *
 * Backed by Node's `AsyncLocalStorage`, so the context propagates through
 * async/await, timers, and microtasks automatically. The middleware
 * (`createRequestContextMiddleware`) wraps each incoming request in a fresh
 * context after the auth probe has populated `req.actor`.
 *
 * Usage:
 *
 * ```ts
 * // read typed field
 * const actor = Context.get('actor');
 *
 * // read the express request from anywhere
 * const req = Context.get('req');
 *
 * // stash / read ad-hoc values
 * Context.set('myService.txId', txId);
 * const txId = Context.get('myService.txId');
 * ```
 */

// -- Well-known typed keys -------------------------------------------

export interface KnownContextFields {
    /** The authenticated actor, if one was resolved by the auth probe. */
    actor: Actor | undefined;
    /** The express request object for this request. */
    req: Request;
    /** A unique id for this request — useful for structured logging / tracing. */
    requestId: string;
    /**
     * The driver name the caller addressed (set by DriverController for
     * `/drivers/call` dispatch); drivers read it to pick a provider.
     */
    driverName: string;
    /**
     * Aborts when the client disconnects before the response has finished (set
     * by DriverController). Long-running drivers poll it so work nobody will
     * receive stops early and is never metered.
     */
    abortSignal: AbortSignal;
    /**
     * When true, `ChatCompletionDriver.complete` treats a request-level
     * upstream 4xx as final instead of falling back to another provider — set
     * by the Anthropic route, which needs the vendor's own error rather than a
     * different provider's translation of it.
     */
    strictUpstreamErrors: boolean;
}

// Every key of `KnownContextFields`, checked both ways by the compiler, so
// `get` and `set` can never disagree about where a known key lives.
const KNOWN_KEY_FLAGS: Record<keyof KnownContextFields, true> = {
    actor: true,
    req: true,
    requestId: true,
    driverName: true,
    abortSignal: true,
    strictUpstreamErrors: true,
};
const KNOWN_KEYS: ReadonlySet<string> = new Set(Object.keys(KNOWN_KEY_FLAGS));

// -- Context store ---------------------------------------------------

interface ContextStore {
    known: Partial<KnownContextFields>;
    extra: Map<string, unknown>;
}

const als = new AsyncLocalStorage<ContextStore>();

const storeValue = (store: ContextStore, key: string, value: unknown) => {
    if (KNOWN_KEYS.has(key)) {
        (store.known as Record<string, unknown>)[key] = value;
    } else {
        store.extra.set(key, value);
    }
};

// -- Public API ------------------------------------------------------

/**
 * Static-style context accessor.
 *
 * Well-known keys (`KnownContextFields`) return typed values. Any other string
 * key hits the generic map and returns `unknown`.
 */
export class Context {
    /**
     * Get a value from the current request context.
     *
     * Well-known keys return typed values; arbitrary string keys return
     * `unknown`. Returns `undefined` when called outside a request scope or
     * when the key hasn't been set.
     */
    /** Get the entire context store (no-arg form). */
    static get(): ContextStore | undefined;
    static get<K extends keyof KnownContextFields>(
        key: K,
    ): KnownContextFields[K] | undefined;
    static get(key: string): unknown;
    static get(key?: string): unknown {
        if (key === undefined) return als.getStore();
        const store = als.getStore();
        if (!store) return undefined;
        if (KNOWN_KEYS.has(key)) {
            return (store.known as Record<string, unknown>)[key];
        }
        return store.extra.get(key);
    }

    /**
     * Set a value on the current request context.
     *
     * Well-known keys are type-checked; arbitrary keys accept `unknown`.
     */
    static set<K extends keyof KnownContextFields>(
        key: K,
        value: KnownContextFields[K],
    ): void;
    static set(key: string, value: unknown): void;
    static set(key: string, value: unknown): void {
        const store = als.getStore();
        if (!store) {
            throw new Error(
                `Context.set('${key}', ...) called outside a request scope`,
            );
        }
        storeValue(store, key, value);
    }

    /**
     * Returns the full context store, or `undefined` when called outside a
     * request scope. Prefer `.get(key)` for individual lookups.
     */
    static current(): ContextStore | undefined {
        return als.getStore();
    }
}

// -- Internal: used by the request-context middleware -----------------

/**
 * Run `fn` in a scope that starts as a copy of the current one, so what it
 * writes is invisible both to the caller and to anything running beside it.
 * Cuts both ways: nothing the callee stores survives the scope.
 */
export const runInDerivedContext = <T>(fn: () => T): T => {
    const parent = als.getStore();
    const store: ContextStore = {
        known: { ...(parent?.known ?? {}) },
        extra: new Map(parent?.extra ?? []),
    };
    return als.run(store, fn);
};

/**
 * Run `fn` inside a new context scope. Used by the request-context middleware
 * to wrap the remainder of the middleware/handler chain.
 */
export const runWithContext = <T>(
    initial: Partial<KnownContextFields>,
    fn: () => T,
): T => {
    const store: ContextStore = { known: {}, extra: new Map() };
    // Routed like `set`, so an untyped caller's extra key stays readable.
    for (const [key, value] of Object.entries(initial)) {
        storeValue(store, key, value);
    }
    return als.run(store, fn);
};
