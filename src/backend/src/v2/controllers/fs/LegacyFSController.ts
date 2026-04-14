import type { RequestHandler } from 'express';
import { PuterController } from '../types.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import { createV1ContextShim } from '../../services/fs/v1compat.js';

/**
 * Mounts all v1 legacy filesystem route modules on the v2 express app.
 *
 * Each v1 route module (`routers/filesystem_api/*.js`) exports an Express
 * Router (via eggspress) that carries its own middleware chain (subdomain
 * check, auth, json parsing, parameter consolidation). We mount them as-is
 * — no rewriting of internals — preceded by a v1 context shim that provides
 * the `Context.get('services')` and `req.services` the handlers expect.
 *
 * This is a transitional layer. When all consumers have moved to the new v2
 * FS endpoints (served by FSController), these legacy routes will be removed.
 */

// ── Lazy-loaded v1 route modules ────────────────────────────────────
//
// Dynamic import of CJS modules from ESM. Each v1 module exports an
// eggspress Router via `module.exports = eggspress(...)`. The dynamic
// import gives us `{ default: Router }`.
//
// We cache the promise so the import happens once (on first request)
// and all subsequent requests get the resolved Router immediately.

type RouterCache = Map<string, RequestHandler | null>;

const routerPaths: Record<string, string> = {
    read: '../../legacy/routers/filesystem_api/read.js',
    write: '../../legacy/routers/filesystem_api/write.js',
    stat: '../../legacy/routers/filesystem_api/stat.js',
    readdir: '../../legacy/routers/filesystem_api/readdir.js',
    copy: '../../legacy/routers/filesystem_api/copy.js',
    move: '../../legacy/routers/filesystem_api/move.js',
    delete: '../../legacy/routers/filesystem_api/delete.js',
    mkdir: '../../legacy/routers/filesystem_api/mkdir.js',
    rename: '../../legacy/routers/filesystem_api/rename.js',
    search: '../../legacy/routers/filesystem_api/search.js',
    'token-read': '../../legacy/routers/filesystem_api/token-read.js',
    touch: '../../legacy/routers/filesystem_api/touch.js',
    update: '../../legacy/routers/filesystem_api/update.js',
    cache: '../../legacy/routers/filesystem_api/cache.js',
    batch: '../../legacy/routers/filesystem_api/batch/all.js',
    'readdir-subdomains': '../../legacy/routers/filesystem_api/readdir-subdomains.mjs',
};

async function loadRouter (key: string): Promise<RequestHandler | null> {
    const path = routerPaths[key];
    if ( ! path ) return null;
    try {
        const mod = await import(`${path}`);
        return (mod.default ?? mod) as RequestHandler;
    } catch ( err ) {
        console.error(`[legacy-fs] failed to load route module '${key}':`, err);
        return null;
    }
}

// ── Additional FS routes outside filesystem_api/ ────────────────────

const additionalRoutePaths: Record<string, string> = {
    writeFile: '../../legacy/routers/writeFile.js',
    openItem: '../../legacy/routers/open_item.js',
    itemMetadata: '../../legacy/routers/itemMetadata.js',
    down: '../../legacy/routers/down.js',
    file: '../../legacy/routers/file.js',
    sign: '../../legacy/routers/sign.js',
    setLayout: '../../legacy/routers/set_layout.js',
    setSortBy: '../../legacy/routers/set_sort_by.js',
    suggestApps: '../../legacy/routers/suggest_apps.js',
    df: '../../legacy/routers/df.js',
};

async function loadAdditionalRouter (key: string): Promise<RequestHandler | null> {
    const path = additionalRoutePaths[key];
    if ( ! path ) return null;
    try {
        const mod = await import(path);
        return (mod.default ?? mod) as RequestHandler;
    } catch ( err ) {
        console.error(`[legacy-fs] failed to load additional route module '${key}':`, err);
        return null;
    }
}

// ── Controller ──────────────────────────────────────────────────────

export class LegacyFSController extends PuterController {
    #cache: RouterCache = new Map();
    #v1Shim: RequestHandler | null = null;
    #additionalCache: RouterCache = new Map();

    registerRoutes (router: PuterRouter): void {
        this.#v1Shim = createV1ContextShim();

        // Mount each v1 filesystem_api route module as `use()` middleware.
        // `use()` is not subject to the root-origin-only gate (it's
        // middleware, not a verb route). The v1 routers handle their own
        // subdomain checks internally via eggspress options.
        for ( const key of Object.keys(routerPaths) ) {
            router.use(this.#createLazyHandler(key, this.#cache, loadRouter));
        }

        // Mount additional FS routes
        for ( const key of Object.keys(additionalRoutePaths) ) {
            router.use(this.#createLazyHandler(key, this.#additionalCache, loadAdditionalRouter));
        }
    }

    /**
     * Creates a handler that lazy-loads the v1 route module on first request,
     * runs the v1 context shim, then delegates to the loaded Router.
     */
    #createLazyHandler (
        key: string,
        cache: RouterCache,
        loader: (key: string) => Promise<RequestHandler | null>,
    ): RequestHandler {
        return async (req, res, next) => {
            let handler = cache.get(key);
            if ( handler === undefined ) {
                handler = await loader(key);
                cache.set(key, handler);
            }
            if ( ! handler ) {
                next();
                return;
            }

            // Run the v1 context shim to set up Context.get('services') etc.
            if ( this.#v1Shim ) {
                this.#v1Shim(req, res, (err?: unknown) => {
                    if ( err ) {
                        next(err);
                        return;
                    }
                    handler!(req, res, next);
                });
            } else {
                handler(req, res, next);
            }
        };
    }
}
