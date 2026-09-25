import { Context } from '@heyputer/backend/src/core';
import { HttpError } from '@heyputer/backend/src/core/http';
import {
    controllersContainers,
    driversContainers,
    servicesContainers,
} from '@heyputer/backend/src/exports';
import { extension } from '@heyputer/backend/src/extensions';
import {
    creditMultiplierFrom,
    toCredits,
} from '@heyputer/backend/src/services/metering/utils';
import type { Request, Response } from 'express';

const services = extension.import('service');
const clients = extension.import('client');

// Cached on first request — the underlying cost catalogues are baked into
// driver/controller source so they only change on deploy.
let cachedAllCosts: Record<string, unknown>[] | null = null;

function collectAllCosts(): Record<string, unknown>[] {
    const all: Record<string, unknown>[] = [];
    const collect = (
        source: Record<string, unknown>,
        kind: 'driver' | 'controller' | 'service',
    ) => {
        for (const [name, instance] of Object.entries(source)) {
            const fn = (
                instance as {
                    getReportedCosts?: () => Record<string, unknown>[];
                }
            )?.getReportedCosts;
            if (typeof fn !== 'function') continue;
            try {
                const entries = fn.call(instance);
                if (!Array.isArray(entries)) continue;
                for (const entry of entries) {
                    all.push({ ...entry, registry: kind, registryKey: name });
                }
            } catch (e) {
                console.warn(
                    `[metering] getReportedCosts failed for ${kind}:${name}:`,
                    (e as Error).message,
                );
            }
        }
    };
    collect(driversContainers as Record<string, unknown>, 'driver');
    collect(controllersContainers as Record<string, unknown>, 'controller');
    // Services report the costs that aren't tied to one endpoint — egress,
    // which is metered for every response there is.
    collect(servicesContainers as Record<string, unknown>, 'service');
    return all;
}

// -- Credits scaling ---------------------------------------------------
//
// When the deployment configures a credit multiplier, every monetary amount
// is scaled to display credits BEFORE it leaves the server — raw metered
// amounts are never reported. Counts, units, and byte figures pass through
// untouched. A response that was scaled says so (`unit: 'credits'`); without
// a configured multiplier amounts pass through raw and clients render them
// as dollars.

/** The per-usage-type records of a UsageByType map, costs scaled. */
const scaleUsageByType = (
    usage: Record<string, unknown>,
    multiplier: number,
): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(usage)) {
        // `allowanceUsed` is the month's allowance-charged spend — monetary,
        // scalar, scaled like the total.
        if (key === 'total' || key === 'allowanceUsed') {
            out[key] = toCredits(Number(value) || 0, multiplier);
        } else if (
            value &&
            typeof value === 'object' &&
            typeof (value as { cost?: unknown }).cost === 'number'
        ) {
            out[key] = {
                ...(value as Record<string, unknown>),
                cost: toCredits((value as { cost: number }).cost, multiplier),
            };
        } else {
            out[key] = value;
        }
    }
    return out;
};

export const handleMeteringUsage = async (
    _req: Request,
    res: Response,
): Promise<void> => {
    const actor = Context.get('actor');
    if (!actor?.user) throw new HttpError(401, 'Authentication required');

    const [actorUsage, allowanceInfo] = await Promise.all([
        services.metering.getActorCurrentMonthUsageDetails(actor),
        services.metering.getAllowedUsage(actor),
    ]);
    const multiplier = creditMultiplierFrom(extension.config);
    if (!multiplier) {
        res.json({ ...actorUsage, allowanceInfo });
        return;
    }
    res.json({
        usage: scaleUsageByType(
            actorUsage.usage as unknown as Record<string, unknown>,
            multiplier,
        ),
        appTotals: Object.fromEntries(
            Object.entries(actorUsage.appTotals).map(([appId, totals]) => [
                appId,
                { ...totals, total: toCredits(totals.total, multiplier) },
            ]),
        ),
        allowanceInfo: {
            ...allowanceInfo,
            remaining: toCredits(allowanceInfo.remaining, multiplier),
            monthUsageAllowance: toCredits(
                allowanceInfo.monthUsageAllowance,
                multiplier,
            ),
            // Monetary addon fields scale; absent ones stay absent rather
            // than materializing as NaN/null. purchasedStorage is bytes.
            addons: Object.fromEntries(
                Object.entries(allowanceInfo.addons ?? {}).map(([k, v]) => [
                    k,
                    (k === 'purchasedCredits' ||
                        k === 'consumedPurchaseCredits') &&
                    typeof v === 'number'
                        ? toCredits(v, multiplier)
                        : v,
                ]),
            ),
            unit: 'credits',
        },
    });
};

export const handleMeteringUsageForApp = async (
    req: Request,
    res: Response,
): Promise<void> => {
    const actor = Context.get('actor');
    if (!actor?.user) throw new HttpError(401, 'Authentication required');

    let appId = String(req.params.appIdOrName ?? '');
    if (!appId) throw new HttpError(400, 'appId parameter is required');

    // If not a UUID-shaped app UID, look up by name
    if (!appId.startsWith('app-')) {
        const appRows = (await clients.db.read(
            'SELECT `uid` FROM `apps` WHERE `name` = ? LIMIT 1',
            [appId],
        )) as Array<{ uid: string }>;
        if (appRows.length > 0) {
            appId = appRows[0].uid;
        } else {
            throw new HttpError(404, 'App not found');
        }
    }

    const appUsage =
        await services.metering.getActorCurrentMonthAppUsageDetails(
            actor,
            appId,
        );
    const multiplier = creditMultiplierFrom(extension.config);
    if (!multiplier) {
        res.json(appUsage);
        return;
    }
    res.json({
        ...scaleUsageByType(
            appUsage as unknown as Record<string, unknown>,
            multiplier,
        ),
        unit: 'credits',
    });
};

export const handleMeteringGlobalUsage = async (
    _req: Request,
    res: Response,
): Promise<void> => {
    const globalUsage = await services.metering.getGlobalUsage();
    res.json(globalUsage);
};

// First hit walks the registries; subsequent hits serve the in-memory cache.
export const handleMeteringAllCosts = async (
    _req: Request,
    res: Response,
): Promise<void> => {
    if (!cachedAllCosts) {
        const raw = collectAllCosts();
        const multiplier = creditMultiplierFrom(extension.config);
        // Price the catalogue in the same unit the usage endpoints report:
        // per-unit credits when a multiplier is configured, raw otherwise.
        cachedAllCosts = multiplier
            ? raw.map(({ ucentsPerUnit, costs_currency: _cc, ...rest }) =>
                  typeof ucentsPerUnit === 'number'
                      ? {
                            ...rest,
                            creditsPerUnit: toCredits(
                                ucentsPerUnit,
                                multiplier,
                            ),
                        }
                      : rest,
              )
            : raw;
    }
    res.json({ costs: cachedAllCosts });
};

/** Dashboard reads over the per-actor KV aggregates. */
const USAGE_READ_LIMIT = {
    scope: 'metering-usage',
    limit: 120,
    window: 60_000,
    key: 'user' as const,
};

extension.get(
    '/metering/usage',
    { subdomain: 'api', requireAuth: true, rateLimit: USAGE_READ_LIMIT },
    handleMeteringUsage,
);

extension.get(
    '/metering/usage/:appIdOrName',
    { subdomain: 'api', requireAuth: true, rateLimit: USAGE_READ_LIMIT },
    handleMeteringUsageForApp,
);

extension.get(
    '/metering/globalUsage',
    {
        subdomain: 'api',
        adminOnly: true,
        // Sums across every shard of the global aggregate. Admin-gated, so
        // this is loop protection — but one accidental poll is an
        // expensive minute.
        rateLimit: {
            scope: 'metering-global-usage',
            limit: 10,
            window: 60_000,
            key: 'user',
        },
    },
    handleMeteringGlobalUsage,
);

extension.get(
    '/metering/allCosts',
    { subdomain: 'api', requireAuth: true, rateLimit: USAGE_READ_LIMIT },
    handleMeteringAllCosts,
);
