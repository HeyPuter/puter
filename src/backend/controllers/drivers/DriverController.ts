/**
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

import type { Request, Response } from 'express';
import { Context } from '../../core/context.js';
import { Controller } from '../../core/http/decorators.js';
import { HttpError } from '../../core/http/HttpError.js';
import { checkDriverRateLimit } from '../../core/http/middleware/rateLimit.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import type { PermissionService } from '../../services/permission/PermissionService.js';
import type { WithLifecycle } from '../../types';
import type { DriverMeta } from '../../drivers/meta.js';
import { isDriverStreamResult, resolveDriverMeta } from '../../drivers/meta.js';
import { PuterController } from '../types.js';

type DriverInstance = WithLifecycle & Record<string, unknown>;

// ── /drivers/xd payload ─────────────────────────────────────────────
//
// Self-contained HTML/JS shipped to the iframe consumer. Listens for
// postMessage events shaped as `{ id, interface, method, params }`,
// forwards to `/drivers/call`, and posts `{ id, result }` back to the
// originating window.
//
// Wire-shape note: the postMessage uses `params` (puter-js's historical
// name) but `/drivers/call` expects `args`; this bridge translates.

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

// ── Controller ──────────────────────────────────────────────────────

/**
 * Routes driver RPC calls through a unified HTTP surface.
 *
 * - `POST /drivers/call` — invoke `<iface>.<method>(args)` on the
 *   registered driver after a per-actor permission + rate-limit check.
 *   Stream-shaped results are piped directly; everything else is
 *   returned as JSON.
 * - `GET /drivers/list-interfaces` — enumerate registered driver
 *   interfaces with their default + alternate implementations.
 * - `GET /drivers/xd` — legacy iframe bridge; serves an HTML page that
 *   proxies `postMessage` RPCs to `/drivers/call` on the same origin.
 *
 * Holds an internal iface → driverName → instance map built at
 * construction time from `this.drivers`. Extensions that register
 * additional drivers end up in that bag before this controller is
 * instantiated, so they show up here automatically.
 */
@Controller('/drivers')
export class DriverController extends PuterController {
    /** iface → Map<driverName, driverInstance> */
    #drivers = new Map<string, Map<string, DriverInstance>>();
    /** iface → default driver name */
    #defaults = new Map<string, string>();

    constructor(...args: ConstructorParameters<typeof PuterController>) {
        super(...args);
        this.#buildIfaceMap();
    }

    // ── Lookup API (used by tests / internals) ──────────────────────

    /** Resolve a driver by interface + optional name (default when omitted). */
    resolve(interfaceName: string, driverName?: string): DriverInstance | null {
        const ifaceMap = this.#drivers.get(interfaceName);
        if (!ifaceMap) return null;
        const name = driverName ?? this.#defaults.get(interfaceName);
        if (!name) return null;
        return ifaceMap.get(name) ?? null;
    }

    listInterfaces(): string[] {
        return [...this.#drivers.keys()];
    }

    listDrivers(interfaceName: string): string[] {
        const ifaceMap = this.#drivers.get(interfaceName);
        return ifaceMap ? [...ifaceMap.keys()] : [];
    }

    getDefault(interfaceName: string): string | undefined {
        return this.#defaults.get(interfaceName);
    }

    // ── Route registration ──────────────────────────────────────────

    registerRoutes(router: PuterRouter): void {
        router.post(
            '/call',
            { subdomain: 'api', requireAuth: true },
            this.#handleCall,
        );
        router.get(
            '/list-interfaces',
            { subdomain: 'api', requireAuth: true },
            this.#handleListInterfaces,
        );
        router.get(
            '/xd',
            { subdomain: 'api', requireAuth: true },
            this.#handleXd,
        );
        router.get(
            '/usage',
            { subdomain: 'api', requireAuth: true },
            this.#handleUsage,
        );
    }

    // ── Handlers ────────────────────────────────────────────────────

    #handleCall = async (req: Request, res: Response): Promise<void> => {
        const {
            interface: ifaceName,
            method,
            driver: driverName,
            args = {},
        } = (req.body ?? {}) as Record<string, unknown>;

        if (!ifaceName || typeof ifaceName !== 'string') {
            throw new HttpError(400, 'Missing or invalid `interface`');
        }
        if (!method || typeof method !== 'string') {
            throw new HttpError(400, 'Missing or invalid `method`');
        }
        const requestedDriver =
            typeof driverName === 'string' ? driverName : undefined;

        const driver = this.resolve(ifaceName, requestedDriver);
        if (!driver) {
            const resolvedName = requestedDriver ?? this.getDefault(ifaceName);
            throw new HttpError(
                404,
                `Driver not found: ${ifaceName}:${resolvedName ?? '(no default)'}`,
            );
        }

        const fn = driver[method];
        if (typeof fn !== 'function') {
            throw new HttpError(
                404,
                `Method '${method}' not found on driver '${ifaceName}'`,
            );
        }

        // Resolve the concrete driver name for permission keys, falling
        // back through prototype metadata → instance field → requested name.
        const resolvedDriverName =
            (driver as Record<string, unknown>).driverName ??
            (Object.getPrototypeOf(driver) as Record<string, unknown>)
                .__driverName ??
            requestedDriver ??
            'unknown';

        if (req.actor) {
            const permService = this.services.permission as unknown as
                | PermissionService
                | undefined;
            if (permService) {
                const permKey = `service:${resolvedDriverName}:ii:${ifaceName}`;
                const hasPermission = await permService.check(
                    req.actor,
                    permKey,
                );
                if (!hasPermission) {
                    throw new HttpError(
                        403,
                        `Permission denied for ${ifaceName}:${method}`,
                        {
                            legacyCode: 'forbidden',
                        },
                    );
                }
            }
        }

        if (!(await checkDriverRateLimit(req, ifaceName, method))) {
            throw new HttpError(429, 'Too many requests.');
        }

        // Stash the requested driver name in Context so multi-provider
        // drivers (TTS/OCR/image/video) can route to the right internal
        // provider when invoked via an alias. `driverName` lives on the
        // generic extras map — not a well-known key — so it doesn't
        // pollute the typed Context surface. Always set, even when no
        // alias was requested, so the driver sees `undefined` rather than
        // a stale value from a prior call.
        Context.set('driverName', requestedDriver);

        // Drivers read actor/context via the Context API — no drilled args.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (fn as (...x: unknown[]) => any).call(
            driver,
            args,
        );

        if (isDriverStreamResult(result)) {
            res.setHeader('Content-Type', result.content_type);
            if (result.chunked) {
                res.setHeader('Transfer-Encoding', 'chunked');
            }
            result.stream.pipe(res);
            return;
        }

        // Drivers can optionally stash top-level response metadata via
        // `Context.set('driverMetadata', ...)`. Used by the chat driver to
        // surface `{service_used, providerUsed}` without polluting the
        // result body — matches v1's wire shape.
        const driverMetadata = Context.get('driverMetadata');

        const payload: Record<string, unknown> = {
            success: true,
            result,
            service: { name: resolvedDriverName },
        };
        if (driverMetadata && typeof driverMetadata === 'object') {
            payload.metadata = driverMetadata;
        }
        res.json(payload);
    };

    #handleListInterfaces = (_req: Request, res: Response): void => {
        const interfaces = this.listInterfaces();
        const out: Record<
            string,
            { drivers: string[]; default: string | undefined }
        > = {};
        for (const iface of interfaces) {
            out[iface] = {
                drivers: this.listDrivers(iface),
                default: this.getDefault(iface),
            };
        }
        res.json(out);
    };

    #handleXd = (_req: Request, res: Response): void => {
        res.type('text/html');
        res.send(XD_HTML);
    };

    /** GET /drivers/usage — monthly driver usage for the authenticated actor. */
    #handleUsage = async (req: Request, res: Response): Promise<void> => {
        const actor = req.actor;
        if (!actor?.user?.id)
            throw new HttpError(401, 'Authentication required');

        const userId = actor.user.id;
        const db = this.clients.db;

        // Per-user usage: aggregate today's counts from monthly_usage_counts
        const userRows = await db.read(
            `SELECT \`year\`, \`month\`, \`service\`, SUM(\`count\`) AS count, MAX(\`max\`) AS max
             FROM \`monthly_usage_counts\`
             WHERE \`user_id\` = ? AND \`app_id\` IS NULL
             GROUP BY \`year\`, \`month\`, \`service\`
             ORDER BY \`year\` DESC, \`month\` DESC
             LIMIT 100`,
            [userId],
        );

        // Per-app usage: aggregate by app
        const appRows = await db.read(
            `SELECT a.\`uid\` AS app_uid, a.\`name\` AS app_name,
                    m.\`year\`, m.\`month\`, m.\`service\`, SUM(m.\`count\`) AS count, MAX(m.\`max\`) AS max
             FROM \`monthly_usage_counts\` m
             LEFT JOIN \`apps\` a ON m.\`app_id\` = a.\`id\`
             WHERE m.\`user_id\` = ? AND m.\`app_id\` IS NOT NULL
             GROUP BY a.\`uid\`, a.\`name\`, m.\`year\`, m.\`month\`, m.\`service\`
             ORDER BY m.\`year\` DESC, m.\`month\` DESC
             LIMIT 500`,
            [userId],
        );

        // Group app rows by app name
        const apps: Record<string, Array<Record<string, unknown>>> = {};
        for (const row of appRows) {
            const name = String(
                (row as Record<string, unknown>).app_name ?? 'unknown',
            );
            if (!apps[name]) apps[name] = [];
            apps[name].push(row as Record<string, unknown>);
        }

        res.json({ user: userRows, apps });
    };

    // ── Internals ───────────────────────────────────────────────────

    #buildIfaceMap(): void {
        const bag = this.drivers as unknown as Record<string, DriverInstance>;
        for (const instance of Object.values(bag)) {
            const meta = resolveDriverMeta(instance);
            if (meta) this.#registerDriver(meta, instance);
        }
    }

    #registerDriver(meta: DriverMeta, instance: DriverInstance): void {
        let ifaceMap = this.#drivers.get(meta.interfaceName);
        if (!ifaceMap) {
            ifaceMap = new Map();
            this.#drivers.set(meta.interfaceName, ifaceMap);
        }
        if (ifaceMap.has(meta.driverName)) {
            console.warn(
                `[driver-controller] overwriting driver ${meta.interfaceName}:${meta.driverName}`,
            );
        }
        ifaceMap.set(meta.driverName, instance);
        // Register each alias pointing at the same instance. Legacy puter-js
        // calls that pass a provider id in the `driver` slot (e.g. the TTS
        // module sends `aws-polly` / `openai-tts` / `elevenlabs-tts` instead
        // of the unified `ai-tts`) resolve here; the handler sets
        // Context.driverName to the alias so the method can route to the
        // right internal provider.
        for (const alias of meta.aliases) {
            if (alias === meta.driverName) continue;
            if (ifaceMap.has(alias)) {
                console.warn(
                    `[driver-controller] alias collision on ${meta.interfaceName}:${alias} — keeping first registration`,
                );
                continue;
            }
            ifaceMap.set(alias, instance);
        }
        if (meta.isDefault || !this.#defaults.has(meta.interfaceName)) {
            this.#defaults.set(meta.interfaceName, meta.driverName);
        }
    }
}
