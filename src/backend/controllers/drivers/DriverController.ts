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

import { metrics } from '@opentelemetry/api';
import type { Request, Response } from 'express';
import { actorUid } from '../../core/actor.js';
import { Context } from '../../core/context.js';
import { Controller } from '../../core/http/decorators.js';
import { HttpError, isHttpError } from '../../core/http/HttpError.js';
import { assertNotUserSession } from '../../core/http/middleware/gates.js';
import {
    acquireDriverConcurrent,
    checkDriverRateLimit,
} from '../../core/http/middleware/rateLimit.js';
import type { PuterRouter } from '../../core/http/PuterRouter.js';
import type { DriverMeta } from '../../drivers/meta.js';
import {
    isDriverStreamResult,
    resolveCallableMethods,
    resolveDriverMeta,
    resolveDriverMethodConcurrent,
    resolveDriverMethodRateLimit,
    resolveDriverMethodRequireSubscription,
} from '../../drivers/meta.js';
import { assertActorHasSubscription } from '../../services/metering/enforcement.js';
import type { PermissionService } from '../../services/permission/PermissionService.js';
import { PermissionUtil } from '../../services/permission/permissionUtil.js';
import type { WithLifecycle } from '../../types';
import { withSpan } from '../../util/span.js';
import { PuterController } from '../types.js';

type DriverInstance = WithLifecycle & Record<string, unknown>;

/**
 * Coarse envelope over the whole `/call` surface, so that spreading calls
 * across many interfaces can't dodge every individual bucket. Per-driver limits
 * are what actually shape traffic.
 *
 * "Coarse" is a constraint, not a description: for this to be an envelope it
 * has to sit _above_ every per-driver budget, or it silently becomes the real
 * limit for the widest ones and overrides the tier policy they declare.
 * `driverPolicies.test.ts` asserts that ordering against every registered
 * driver, so raising a driver's budget past this number fails there rather than
 * in production. The headroom above the widest driver (notifications, at
 * 3000/30s) is what leaves room for one caller to be busy on two interfaces at
 * once.
 */
export const DRIVERS_CALL_LIMIT = {
    scope: 'drivers-call',
    limit: 8000,
    window: 60_000,
    key: 'user' as const,
};

// Every driver call is timed here already, for the lifecycle events below.
// Recording the same number as a histogram makes the per-interface latency
// distribution available downstream; which interfaces are worth keeping is a
// collector-side decision, not one made here, so this deliberately records
// everything and lets the export pipeline drop what it doesn't want.
const meter = metrics.getMeter('puter-backend');
const driverCallDuration = meter.createHistogram('driver.call.duration', {
    description: 'Wall time of a driver method call',
    unit: 'ms',
});

const extractUpstreamStatus = (e: {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    $metadata?: { httpStatusCode?: number };
    message?: string;
}): number | undefined => {
    const direct = e.status ?? e.statusCode;
    if (typeof direct === 'number') return direct;
    const fromResponse = e.response?.status;
    if (typeof fromResponse === 'number') return fromResponse;
    const fromAws = e.$metadata?.httpStatusCode;
    if (typeof fromAws === 'number') return fromAws;
    // Message sniff (e.g. "... failed with status 422 ...").
    // Only trust if it's adjacent to a status-indicating word to
    // avoid matching random 4xx/5xx-looking numbers in payloads.
    const msg = e.message;
    if (typeof msg === 'string') {
        const m = msg.match(/\bstatus(?:\s+code)?\s*[:=]?\s*(4\d\d|5\d\d)\b/i);
        if (m) return Number(m[1]);
    }
    return undefined;
};

const translateProviderError = (err: unknown): unknown => {
    if (isHttpError(err)) return err;
    if (!err || typeof err !== 'object') return err;
    const e = err as {
        status?: number;
        statusCode?: number;
        response?: { status?: number };
        $metadata?: { httpStatusCode?: number };
        message?: string;
        error?: { code?: string; type?: string; message?: string };
        code?: string;
    };
    const status = extractUpstreamStatus(e);
    if (typeof status !== 'number') return err;

    const msg = e.error?.message ?? e.message ?? 'Upstream provider error';
    const upstreamCode = e.error?.code ?? e.code;
    const fields = { upstreamStatus: status, upstreamCode };

    if (status === 429) {
        return new HttpError(429, msg, {
            legacyCode: 'upstream_rate_limited',
            fields,
        });
    }
    if (status === 401 || status === 403) {
        return new HttpError(500, msg, {
            legacyCode: 'upstream_auth_failed',
            fields,
        });
    }
    if (status >= 500) {
        return new HttpError(400, 'AI provider unavailable', {
            legacyCode: 'upstream_provider_unavailable',
            fields,
        });
    }
    if (status >= 400) {
        return new HttpError(400, msg, {
            legacyCode: 'upstream_bad_request',
            fields,
        });
    }
    return err;
};

@Controller('/drivers')
export class DriverController extends PuterController {
    /** Iface → Map<driverName, driverInstance> */
    #drivers = new Map<string, Map<string, DriverInstance>>();
    /** Iface → default driver name */
    #defaults = new Map<string, string>();
    /**
     * Driver instance → resolved meta. Cached so the per-call rate-limit lookup
     * doesn't have to walk prototype chains on every request.
     */
    #meta = new WeakMap<DriverInstance, DriverMeta>();
    /**
     * Driver instance → the set of method names callable via `/drivers/call`.
     * Resolved once at registration (server startup) via
     * `resolveCallableMethods`; the request path only does a `Set.has` lookup.
     * This is what stops framework/lifecycle methods (`onServerStart`, etc.)
     * and `Object.prototype` members from being invoked by remote callers.
     */
    #callableMethods = new WeakMap<DriverInstance, Set<string>>();

    constructor(...args: ConstructorParameters<typeof PuterController>) {
        super(...args);
        this.#buildIfaceMap();
    }

    // -- Lookup API (used by tests / internals) ----------------------

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

    // -- Route registration ------------------------------------------

    registerRoutes(router: PuterRouter): void {
        router.post(
            '/call',
            {
                subdomain: 'api',
                requireAuth: true,
                rateLimit: DRIVERS_CALL_LIMIT,
            },
            this.#handleCall,
        );
        router.get(
            '/list-interfaces',
            {
                subdomain: 'api',
                requireAuth: true,
                // Static introspection output, read once at boot.
                rateLimit: {
                    scope: 'drivers-list-interfaces',
                    limit: 60,
                    window: 60_000,
                    key: 'user',
                },
            },
            this.#handleListInterfaces,
        );
    }

    // -- Handlers ----------------------------------------------------

    #handleCall = async (req: Request, res: Response): Promise<void> => {
        const {
            interface: ifaceName,
            method,
            driver: driverName,
            args = {},
        } = (req.body ?? {}) as Record<string, unknown>;

        if (!ifaceName || typeof ifaceName !== 'string') {
            throw new HttpError(400, 'Missing or invalid `interface`', {
                legacyCode: 'bad_request',
            });
        }
        if (!method || typeof method !== 'string') {
            throw new HttpError(400, 'Missing or invalid `method`', {
                legacyCode: 'bad_request',
            });
        }
        const requestedDriver =
            typeof driverName === 'string' ? driverName : undefined;

        const driver = this.resolve(ifaceName, requestedDriver);
        if (!driver) {
            const resolvedName = requestedDriver ?? this.getDefault(ifaceName);
            throw new HttpError(
                404,
                `Driver not found: ${ifaceName}:${resolvedName ?? '(no default)'}`,
                { legacyCode: 'not_found' },
            );
        }

        // Only methods in the pre-resolved callable set are dispatchable.
        // This excludes framework/lifecycle hooks (onServerStart, etc.),
        // inherited base methods, and Object.prototype members, none of
        // which are part of any interface's RPC contract.
        const callable = this.#callableMethods.get(driver);
        if (!callable?.has(method)) {
            throw new HttpError(
                404,
                `Method '${method}' not found on driver '${ifaceName}'`,
                { legacyCode: 'not_found' },
            );
        }
        const fn = driver[method];

        // Resolve the concrete driver name for permission keys, falling
        // back through prototype metadata → instance field → requested name.
        const resolvedDriverName =
            (driver as Record<string, unknown>).driverName ??
            (Object.getPrototypeOf(driver) as Record<string, unknown>)
                .__driverName ??
            requestedDriver ??
            'unknown';

        const driverMeta = this.#meta.get(driver);

        // Drivers flagged `noUserSession` refuse the bare
        // account-session ("root") token: callers must present an app or
        // worker token, or an API token minted from the dashboard. This is
        // the per-driver counterpart of the `noUserSession` route option —
        // `/drivers/call` is one shared route, so the flag has to live on
        // the driver rather than in `RouteOptions`. Checked before the
        // permission scan so a session-token caller always gets the
        // credential-shape message, not a permission error.
        if (driverMeta?.noUserSession) {
            assertNotUserSession(req.actor);
        }

        if (req.actor) {
            const permService = this.services.permission as unknown as
                PermissionService | undefined;
            if (permService) {
                // Build via PermissionUtil.join so any `:` in a driver or
                // interface name is escaped — raw interpolation would let a
                // crafted name shift permission-segment boundaries and match
                // a broader/narrower parent than intended in the scan logic.
                const permKey = PermissionUtil.join(
                    'service',
                    String(resolvedDriverName),
                    'ii',
                    ifaceName,
                );
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

        // Subscriber-only methods. Declared per-driver
        // (`@Driver({ requireSubscription })`) because `/drivers/call` is a
        // single route and a route option would apply to every driver at once.
        // Checked before the rate limit — the same order the route chain uses
        // — so a caller whose plan never included the method is told that
        // rather than spending a bucket on it.
        const subscriptionRequirement = resolveDriverMethodRequireSubscription(
            driverMeta?.requireSubscription,
            method,
        );
        if (subscriptionRequirement !== undefined) {
            await assertActorHasSubscription(
                this.services.metering,
                req.actor,
                subscriptionRequirement,
                this.config,
            );
        }

        // Per-method rate-limit and concurrent specs both live on the
        // driver's resolved meta (set by `@Driver({ rateLimit, concurrent })`
        // or imperative fields). Rate-limit is single-shot; concurrent
        // acquires a slot that must be released when the response is done
        // — we hook `res.finish` / `res.close` for that so streamed
        // responses hold their slot until the stream drains, and aborted
        // requests still give the slot back.
        const rateLimitSpec = resolveDriverMethodRateLimit(
            driverMeta?.rateLimit,
            method,
        );
        if (
            !(await checkDriverRateLimit(req, ifaceName, method, rateLimitSpec))
        ) {
            // Deliberately unalarmed: a caller spending its own budget is
            // the limit working, not an incident. The 429 is the signal.
            throw new HttpError(429, 'Too many requests.', {
                legacyCode: 'too_many_requests',
            });
        }

        const concurrentSpec = resolveDriverMethodConcurrent(
            driverMeta?.concurrent,
            method,
        );
        // Only acquire (and attach release listeners) when the driver
        // actually declared a concurrency cap. Skipping in the unbounded
        // case keeps the hot path free of needless event-listener churn
        // and avoids requiring `res.once` on test stubs that mock only
        // the response surface they care about.
        if (concurrentSpec) {
            const handle = await acquireDriverConcurrent(
                req,
                ifaceName,
                method,
                concurrentSpec,
            );
            if (!handle.ok) {
                // Unalarmed for the same reason as the rate-limit rejection
                // above: hitting a declared cap is the cap doing its job.
                throw new HttpError(429, 'Too many concurrent requests.', {
                    legacyCode: 'too_many_requests',
                });
            }
            let released = false;
            const release = () => {
                if (released) return;
                released = true;
                void handle.release();
            };
            // If the handler throws before responding, the express error
            // handler will eventually send a response — `finish` fires then,
            // so we still release. `close` covers client aborts.
            res.once('finish', release);
            res.once('close', release);
        }

        // Stash the requested driver name in Context so multi-provider
        // drivers (TTS/OCR/image/video) can route to the right internal
        // provider when invoked via an alias. `driverName` lives on the
        // generic extras map — not a well-known key — so it doesn't
        // pollute the typed Context surface. Always set, even when no
        // alias was requested, so the driver sees `undefined` rather than
        // a stale value from a prior call.
        Context.set('driverName', requestedDriver);

        // Per-method lifecycle events, scoped to `driver.<iface>.<method>`.
        // Subscribers can listen on `driver.*`, `driver.<iface>.*`, or the
        // exact key. `before` is emitted via `emitAndWait` so a listener may
        // veto the call by setting `allow = false` (emits `reject`, throws
        // 403); otherwise `after`/`error` carry the result/error + duration.
        const actor = req.actor ? actorUid(req.actor) : undefined;
        const resolved = String(resolvedDriverName);
        const beforeEvent = {
            phase: 'before' as const,
            iface: ifaceName,
            method,
            driver: resolved,
            actor: req.actor,
            actorUid: actor,
            args,
            allow: true as boolean,
            rejectReason: undefined as string | undefined,
        };
        await this.clients.event?.emitAndWait(
            `driver.${ifaceName}.${method}.before`,
            beforeEvent,
            {},
        );
        if (beforeEvent.allow === false) {
            this.clients.event?.emit(
                `driver.${ifaceName}.${method}.reject`,
                {
                    phase: 'reject',
                    iface: ifaceName,
                    method,
                    driver: resolved,
                    actor: req.actor,
                    actorUid: actor,
                    args,
                    rejectReason: beforeEvent.rejectReason,
                },
                {},
            );
            throw new HttpError(
                403,
                beforeEvent.rejectReason ??
                    `Blocked by policy: ${ifaceName}:${method}`,
                { legacyCode: 'forbidden' },
            );
        }

        // Drivers read actor/context via the Context API — no drilled args.
        // The span ends when the method returns; for streamed results that
        // is stream start, not stream drain (same window the lifecycle
        // events below report as durationMs).
        const startedAt = Date.now();
        let result;
        try {
            result = await withSpan(
                `driver.${ifaceName}.${method}`,
                {
                    driver: ifaceName,
                    'driver.method': method,
                    'driver.name': resolved,
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                () => (fn as (...x: unknown[]) => any).call(driver, args),
            );
        } catch (e) {
            driverCallDuration.record(Date.now() - startedAt, {
                driver: ifaceName,
                'driver.method': method,
                outcome: 'error',
            });
            this.clients.event?.emit(
                `driver.${ifaceName}.${method}.error`,
                {
                    phase: 'error',
                    iface: ifaceName,
                    method,
                    driver: resolved,
                    actor: req.actor,
                    actorUid: actor,
                    args,
                    error: e,
                    durationMs: Date.now() - startedAt,
                },
                {},
            );
            throw translateProviderError(e);
        }

        // Same window the span and the lifecycle events measure: for streamed
        // results this is stream start, not stream drain. Worth remembering
        // when reading AI latency — it is time-to-first-token, not total.
        driverCallDuration.record(Date.now() - startedAt, {
            driver: ifaceName,
            'driver.method': method,
            outcome: 'ok',
        });
        this.clients.event?.emit(
            `driver.${ifaceName}.${method}.after`,
            {
                phase: 'after',
                iface: ifaceName,
                method,
                driver: resolved,
                actor: req.actor,
                actorUid: actor,
                args,
                result,
                durationMs: Date.now() - startedAt,
            },
            {},
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

    // -- Internals ---------------------------------------------------

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
        // Cache the resolved meta so the request hot-path can read the
        // per-method rate-limit spec without re-walking the prototype.
        this.#meta.set(instance, meta);
        // Resolve the callable RPC surface once, at startup. The request
        // path checks membership against this set instead of reflecting on
        // the live instance, so lifecycle hooks / inherited framework
        // methods can never be dispatched.
        this.#callableMethods.set(instance, resolveCallableMethods(instance));
        // Register each alias pointing at the same instance. Calls that pass
        // a provider id in the `driver` slot (e.g. `aws-polly` or
        // `openai-tts` instead of the unified `ai-tts`, as SDK bundles
        // predating the unified drivers do) resolve here; the handler sets
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
