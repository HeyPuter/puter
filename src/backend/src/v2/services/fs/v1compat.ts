import type { RequestHandler } from 'express';

/**
 * Bridge middleware that sets up a v1-compatible `Context` scope for legacy
 * FS route handlers. v1 code depends on `Context.get('services')` (v1's
 * AsyncLocalStorage context) which is populated by v1's ContextInitService.
 * When legacy routes are mounted on the v2 express app, that v1 middleware
 * hasn't run, so we shim it here.
 *
 * This works as long as v1 services are still booting alongside v2 during
 * the transition (they populate `globalThis.services`). When v1 is fully
 * retired, these legacy routes get deleted.
 */

// v1's Context module — CJS, imported dynamically once.
let V1Context: {
    create: (values: Record<string, unknown>, label?: string) => {
        arun: <T>(fn: () => T | Promise<T>) => Promise<T>;
    };
} | null = null;

let v1ContextLoaded = false;

async function loadV1Context (): Promise<void> {
    if ( v1ContextLoaded ) return;
    try {
        const mod = await import('../../legacy/util/context.js');
        V1Context = mod.Context ?? (mod as { default?: { Context?: unknown } }).default?.Context ?? null;
    } catch {
        // v1 context module not available — legacy routes won't work
        V1Context = null;
    }
    v1ContextLoaded = true;
}

/**
 * Middleware that wraps the remaining handler chain in a v1 Context scope.
 * Install before any legacy route handler so v1 code can access
 * `Context.get('services')`, `Context.get('user')`, etc.
 *
 * Also populates `req.services` which many v1 routes read directly.
 */
export const createV1ContextShim = (): RequestHandler => {
    return async (req, _res, next) => {
        await loadV1Context();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const globalServices = (globalThis as any).services;
        if ( ! globalServices || ! V1Context ) {
            // v1 runtime not available — pass through and hope for the best
            next();
            return;
        }

        // Make services available on req (v1 routes read this directly)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req as any).services = globalServices;

        // v1's ContextInitService creates a Context with services, db, etc.
        // We create a minimal one that covers what legacy routes need.
        const ctx = V1Context.create({
            services: globalServices,
        }, 'v2-legacy-bridge');

        // Run the rest of the chain inside v1's ALS scope
        try {
            await ctx.arun(async () => {
                // Some v1 code also expects these on the context
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const v1Ctx = await import('../../legacy/util/context.js') as any;
                const currentCtx = v1Ctx.Context.get(undefined, { allow_fallback: true });
                if ( currentCtx?.set && req.actor ) {
                    // Bridge v2 actor to v1 actor shape if v1 auth hasn't run yet
                    // v1 routes have their own auth middleware that will overwrite this
                    currentCtx.set('actor', req.actor);
                }
                next();
            });
        } catch ( err ) {
            next(err);
        }
    };
};
