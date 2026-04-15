import type { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { HttpError } from '../core/http/HttpError.js';
import { PuterRouter } from '../core/http/PuterRouter.js';
import { checkDriverRateLimit } from '../core/http/middleware/rateLimit.js';
import type { PermissionService } from '../services/permission/PermissionService.js';
import type { WithLifecycle } from '../types';

// ── Stream result convention ────────────────────────────────────────
//
// Driver methods that return a stream instead of JSON wrap the readable
// in this shape. The `/call` handler detects it and pipes to the HTTP
// response instead of calling `res.json()`.

export interface DriverStreamResult {
    /** Discriminant — must be `'stream'`. */
    dataType: 'stream';
    /** MIME type sent as Content-Type (e.g. `'application/x-ndjson'`). */
    content_type: string;
    /** When true, sets `Transfer-Encoding: chunked`. */
    chunked?: boolean;
    /** The readable stream to pipe to the response. */
    stream: Readable;
}

export function isDriverStreamResult (v: unknown): v is DriverStreamResult {
    return !!v && typeof v === 'object' && (v as Record<string, unknown>).dataType === 'stream'
        && 'stream' in v;
}

/**
 * Metadata keys stored on driver prototypes by the `@Driver` decorator.
 * Imperative drivers set these as instance properties instead.
 */
export const DRIVER_INTERFACE_KEY = '__driverInterface' as const;
export const DRIVER_NAME_KEY = '__driverName' as const;
export const DRIVER_DEFAULT_KEY = '__driverDefault' as const;

/**
 * Resolved metadata for a registered driver. Read from either decorator
 * metadata or imperative instance properties.
 */
export interface DriverMeta {
    /** The interface this driver implements (e.g. 'puter-chat-completion'). */
    interfaceName: string;
    /** Unique name within its interface (e.g. 'openai-completion', 'claude'). */
    driverName: string;
    /** When true, this driver is the default for its interface. */
    isDefault: boolean;
}

/**
 * Extract driver metadata from a driver instance. Checks decorator-set
 * prototype metadata first, then falls back to instance properties.
 * Returns `null` if the driver doesn't declare an interface.
 */
export function resolveDriverMeta (driver: WithLifecycle & Record<string, unknown>): DriverMeta | null {
    const proto = Object.getPrototypeOf(driver) as Record<string, unknown>;

    const interfaceName =
        (proto[DRIVER_INTERFACE_KEY] as string | undefined)
        ?? (driver.driverInterface as string | undefined);
    const driverName =
        (proto[DRIVER_NAME_KEY] as string | undefined)
        ?? (driver.driverName as string | undefined);
    const isDefault =
        (proto[DRIVER_DEFAULT_KEY] as boolean | undefined)
        ?? (driver.isDefault as boolean | undefined)
        ?? false;

    if ( !interfaceName || !driverName ) return null;

    return { interfaceName, driverName, isDefault };
}

// ── /drivers/xd payload ─────────────────────────────────────────────
//
// Self-contained HTML/JS shipped to the iframe consumer. Listens for
// postMessage events shaped as `{ id, interface, method, params }`,
// forwards to `/drivers/call`, and posts `{ id, result }` back to the
// originating window.
//
// Wire-shape note: the postMessage uses `params` (puter-js's historical
// name) but `/drivers/call` expects `args`. v1's JSON path forwarded
// `params` verbatim and so silently failed; this port translates.

const XD_SCRIPT = /* js */ `
(function () {
    const call = async ({ interface_name, method_name, params }) => {
        const response = await fetch('/drivers/call', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                interface: interface_name,
                method: method_name,
                args: params,
            }),
        });
        return await response.json();
    };

    const fcall = async ({ interface_name, method_name, params }) => {
        const form = new FormData();
        form.append('interface', interface_name);
        form.append('method', method_name);
        for (const k in params) {
            form.append(k, params[k]);
        }
        const response = await fetch('/drivers/call', {
            method: 'POST',
            body: form,
        });
        return await response.json();
    };

    window.addEventListener('message', async (event) => {
        const { id, interface: iface, method, params } = event.data || {};
        let has_file = false;
        for (const k in params) {
            if (params[k] instanceof File) {
                has_file = true;
                break;
            }
        }
        const result = has_file
            ? await fcall({ interface_name: iface, method_name: method, params })
            : await call({ interface_name: iface, method_name: method, params });
        if (event.source) {
            event.source.postMessage({ id, result }, event.origin);
        }
    });
})();
`;

const XD_HTML = `<!DOCTYPE html>
<html>
    <head>
        <title>Puter Driver API</title>
        <script>
            document.addEventListener('DOMContentLoaded', function () {
                ${XD_SCRIPT}
            });
        </script>
    </head>
    <body></body>
</html>`;

// ── Registry ────────────────────────────────────────────────────────

/**
 * Central registry for driver implementations. Maps interface names to
 * named implementations.
 *
 * Populated by `PuterServer` during boot from both the built-in driver
 * registry and extension-registered drivers. The registry owns the
 * `/drivers/*` HTTP endpoints directly — no separate controller needed.
 */
export class DriverRegistry {
    /** iface → Map<driverName, driverInstance> */
    #drivers = new Map<string, Map<string, WithLifecycle & Record<string, unknown>>>();
    /** iface → default driver name */
    #defaults = new Map<string, string>();
    #permService: PermissionService | undefined;

    setPermissionService (svc: PermissionService): void {
        this.#permService = svc;
    }

    register (meta: DriverMeta, instance: WithLifecycle & Record<string, unknown>): void {
        let ifaceMap = this.#drivers.get(meta.interfaceName);
        if ( ! ifaceMap ) {
            ifaceMap = new Map();
            this.#drivers.set(meta.interfaceName, ifaceMap);
        }
        if ( ifaceMap.has(meta.driverName) ) {
            console.warn(`[driver-registry] overwriting driver ${meta.interfaceName}:${meta.driverName}`);
        }
        ifaceMap.set(meta.driverName, instance);

        if ( meta.isDefault || !this.#defaults.has(meta.interfaceName) ) {
            this.#defaults.set(meta.interfaceName, meta.driverName);
        }
    }

    /**
     * Resolve a driver by interface + optional name. If name is omitted,
     * returns the default driver for that interface.
     */
    resolve (interfaceName: string, driverName?: string): (WithLifecycle & Record<string, unknown>) | null {
        const ifaceMap = this.#drivers.get(interfaceName);
        if ( ! ifaceMap ) return null;

        const name = driverName ?? this.#defaults.get(interfaceName);
        if ( ! name ) return null;

        return ifaceMap.get(name) ?? null;
    }

    /** List all registered interface names. */
    listInterfaces (): string[] {
        return [...this.#drivers.keys()];
    }

    /** List all driver names registered for a given interface. */
    listDrivers (interfaceName: string): string[] {
        const ifaceMap = this.#drivers.get(interfaceName);
        return ifaceMap ? [...ifaceMap.keys()] : [];
    }

    /** Get the default driver name for an interface. */
    getDefault (interfaceName: string): string | undefined {
        return this.#defaults.get(interfaceName);
    }

    // ── HTTP endpoints ──────────────────────────────────────────────

    /**
     * Register the `/drivers/*` routes on the given router.
     * Called by PuterServer after all drivers have been registered.
     */
    registerRoutes (router: PuterRouter): void {
        router.post('/call', { subdomain: 'api', requireAuth: true }, async (req: Request, res: Response) => {
            const {
                interface: ifaceName,
                method,
                driver: driverName,
                args = {},
            } = req.body ?? {};

            if ( !ifaceName || typeof ifaceName !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `interface`');
            }
            if ( !method || typeof method !== 'string' ) {
                throw new HttpError(400, 'Missing or invalid `method`');
            }

            // Resolve driver
            const driver = this.resolve(ifaceName, driverName);
            if ( ! driver ) {
                const resolvedName = driverName ?? this.getDefault(ifaceName);
                throw new HttpError(404, `Driver not found: ${ifaceName}:${resolvedName ?? '(no default)'}`);
            }

            // Check method exists
            const fn = driver[method];
            if ( typeof fn !== 'function' ) {
                throw new HttpError(404, `Method '${method}' not found on driver '${ifaceName}'`);
            }

            // Resolve the driver name for permission keys
            const resolvedDriverName = (driver as Record<string, unknown>).driverName
                ?? (Object.getPrototypeOf(driver) as Record<string, unknown>).__driverName
                ?? driverName
                ?? 'unknown';

            // Permission check
            if ( req.actor && this.#permService ) {
                const permKey = `service:${resolvedDriverName}:ii:${ifaceName}`;
                const hasPermission = await this.#permService.check(req.actor, permKey);
                if ( ! hasPermission ) {
                    throw new HttpError(403, `Permission denied for ${ifaceName}:${method}`, {
                        legacyCode: 'forbidden',
                    });
                }
            }

            // Per-user rate limit on driver calls
            if ( ! checkDriverRateLimit(req, ifaceName, method) ) {
                throw new HttpError(429, 'Too many requests.');
            }

            // Invoke — driver reads actor/context via Context API, no drilled params
            const result = await (fn as Function).call(driver, args);

            // Stream result — pipe directly to the HTTP response
            if ( isDriverStreamResult(result) ) {
                res.setHeader('Content-Type', result.content_type);
                if ( result.chunked ) {
                    res.setHeader('Transfer-Encoding', 'chunked');
                }
                result.stream.pipe(res);
                return;
            }

            res.json({
                success: true,
                result,
                service: { name: resolvedDriverName },
            });
        });

        router.get('/list-interfaces', { subdomain: 'api', requireAuth: true }, async (_req: Request, res: Response) => {
            const interfaces = this.listInterfaces();
            const result: Record<string, { drivers: string[]; default: string | undefined }> = {};

            for ( const iface of interfaces ) {
                result[iface] = {
                    drivers: this.listDrivers(iface),
                    default: this.getDefault(iface),
                };
            }

            res.json(result);
        });

        // Cross-document driver bridge — serves a tiny HTML page whose
        // inline script proxies postMessage RPCs to `/drivers/call` on
        // the same origin. Mounted on the `api` subdomain so the
        // relative fetch lands on the gated `/drivers/call` route.
        router.get('/xd', { subdomain: 'api', requireAuth: true }, (_req: Request, res: Response) => {
            res.type('text/html');
            res.send(XD_HTML);
        });
    }
}
