import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request } from 'express';
import type { Actor } from './actor';

/**
 * Per-request context with both typed well-known fields AND an open-ended
 * key-value map for ad-hoc data. Matches v1's `Context` dual nature: common
 * fields (`actor`, `req`) are typed for autocomplete / safety, while the
 * generic `get`/`set` bag lets any code stash per-request values without
 * threading them through function arguments.
 *
 * Backed by Node's `AsyncLocalStorage`, so the context propagates through
 * async/await, timers, and microtasks automatically. The middleware
 * (`createRequestContextMiddleware`) wraps each incoming request in a fresh
 * context after the auth probe has populated `req.actor`.
 *
 * Usage:
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

// ── Well-known typed keys ───────────────────────────────────────────

export interface KnownContextFields {
    /** The authenticated actor, if one was resolved by the auth probe. */
    actor: Actor | undefined;
    /** The express request object for this request. */
    req: Request;
    /** A unique id for this request — useful for structured logging / tracing. */
    requestId: string;
}

// ── Context store ───────────────────────────────────────────────────

interface ContextStore {
    known: Partial<KnownContextFields>;
    extra: Map<string, unknown>;
}

const als = new AsyncLocalStorage<ContextStore>();

// ── Public API: static-method style matching v1's Context ───────────

/**
 * Static-style context accessor. Matches v1's `Context.get(key)` /
 * `Context.set(key, value)` so migration is straightforward.
 *
 * Well-known keys (`actor`, `req`, `requestId`) return typed values.
 * Any other string key hits the generic map and returns `unknown`.
 */
export class Context {
    /**
     * Get a value from the current request context.
     *
     * Well-known keys return typed values; arbitrary string keys
     * return `unknown`. Returns `undefined` when called outside a
     * request scope or when the key hasn't been set.
     */
    static get<K extends keyof KnownContextFields> (key: K): KnownContextFields[K] | undefined;
    static get (key: string): unknown;
    static get (key: string): unknown {
        const store = als.getStore();
        if ( ! store ) return undefined;
        if ( key in store.known ) {
            return (store.known as Record<string, unknown>)[key];
        }
        return store.extra.get(key);
    }

    /**
     * Set a value on the current request context.
     *
     * Well-known keys are type-checked; arbitrary keys accept `unknown`.
     */
    static set<K extends keyof KnownContextFields> (key: K, value: KnownContextFields[K]): void;
    static set (key: string, value: unknown): void;
    static set (key: string, value: unknown): void {
        const store = als.getStore();
        if ( ! store ) {
            throw new Error(`Context.set('${key}', ...) called outside a request scope`);
        }
        if ( key === 'actor' || key === 'req' || key === 'requestId' ) {
            (store.known as Record<string, unknown>)[key] = value;
        } else {
            store.extra.set(key, value);
        }
    }

    /**
     * Returns the full context store, or `undefined` when called outside a
     * request scope. Prefer `.get(key)` for individual lookups.
     */
    static current (): ContextStore | undefined {
        return als.getStore();
    }
}

// ── Internal: used by the request-context middleware ─────────────────

/**
 * Run `fn` inside a new context scope. Used by the request-context
 * middleware to wrap the remainder of the middleware/handler chain.
 */
export const runWithContext = <T>(
    initial: Partial<KnownContextFields>,
    fn: () => T,
): T => {
    const store: ContextStore = {
        known: { ...initial },
        extra: new Map(),
    };
    return als.run(store, fn);
};
