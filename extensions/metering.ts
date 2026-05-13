import type { Request, Response } from 'express';
import { Context } from '@heyputer/backend/src/core';
import { HttpError } from '@heyputer/backend/src/core/http';
import {
    controllersContainers,
    driversContainers,
} from '@heyputer/backend/src/exports';
import { extension } from '@heyputer/backend/src/extensions';

const services = extension.import('service');
const clients = extension.import('client');

// Cached on first request — the underlying cost catalogues are baked into
// driver/controller source so they only change on deploy.
let cachedAllCosts: Record<string, unknown>[] | null = null;

function collectAllCosts(): Record<string, unknown>[] {
    const all: Record<string, unknown>[] = [];
    const collect = (
        source: Record<string, unknown>,
        kind: 'driver' | 'controller',
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
    return all;
}

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
    res.json({ ...actorUsage, allowanceInfo });
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
    res.json(appUsage);
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
        cachedAllCosts = collectAllCosts();
    }
    res.json({ costs: cachedAllCosts });
};

extension.get(
    '/metering/usage',
    { subdomain: 'api', requireAuth: true },
    handleMeteringUsage,
);

extension.get(
    '/metering/usage/:appIdOrName',
    { subdomain: 'api', requireAuth: true },
    handleMeteringUsageForApp,
);

extension.get(
    '/metering/globalUsage',
    { subdomain: 'api', adminOnly: true },
    handleMeteringGlobalUsage,
);

extension.get(
    '/metering/allCosts',
    { subdomain: 'api', requireAuth: true },
    handleMeteringAllCosts,
);
