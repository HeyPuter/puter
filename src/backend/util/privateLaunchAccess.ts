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

import type { EventClient } from '../clients/event/EventClient';

/**
 * Emits `app.privateAccess.resolveLaunch` so the marketplace extension can
 * decide whether a private app may launch for the current actor; returns the
 * normalised decision with a fallback to `app-center` on denial.
 *
 * Public apps short-circuit to `hasAccess: true` without an emit.
 */

const DEFAULT_FALLBACK_APP_NAME = 'app-center';

export interface PrivateLaunchDecision {
    hasAccess: boolean;
    fallbackAppName?: string;
    fallbackArgs?: { path: string };
    reason?: string;
    checkedBy?: string;
}

interface AppLike {
    uid?: string;
    name?: string;
    is_private?: boolean | number | null;
}

function buildFallbackPath(appName: string | undefined): string {
    if (typeof appName !== 'string' || !appName.trim()) return '/app';
    return `/app/${encodeURIComponent(appName.trim())}`;
}

function buildDefaultDenied(
    appName: string | undefined,
    reason: string,
): PrivateLaunchDecision {
    return {
        hasAccess: false,
        fallbackAppName: DEFAULT_FALLBACK_APP_NAME,
        fallbackArgs: { path: buildFallbackPath(appName) },
        reason,
        checkedBy: 'core/private-launch-access',
    };
}

function normalize(
    decision: PrivateLaunchDecision | undefined,
    appName: string | undefined,
): PrivateLaunchDecision {
    if (!decision || typeof decision !== 'object') {
        return buildDefaultDenied(appName, 'invalid-private-access-result');
    }
    if (decision.hasAccess) {
        return {
            hasAccess: true,
            reason:
                typeof decision.reason === 'string'
                    ? decision.reason
                    : undefined,
            checkedBy:
                typeof decision.checkedBy === 'string'
                    ? decision.checkedBy
                    : undefined,
        };
    }
    const fallbackAppName =
        typeof decision.fallbackAppName === 'string' &&
        decision.fallbackAppName.trim()
            ? decision.fallbackAppName.trim()
            : DEFAULT_FALLBACK_APP_NAME;
    const fallbackPath = decision.fallbackArgs?.path;
    return {
        hasAccess: false,
        fallbackAppName,
        fallbackArgs:
            typeof fallbackPath === 'string' && fallbackPath.trim()
                ? { path: fallbackPath.trim() }
                : { path: buildFallbackPath(appName) },
        reason:
            typeof decision.reason === 'string' ? decision.reason : undefined,
        checkedBy:
            typeof decision.checkedBy === 'string'
                ? decision.checkedBy
                : undefined,
    };
}

export async function resolvePrivateLaunchAccess({
    app,
    eventClient,
    userUid,
    source,
    args,
}: {
    app: AppLike | null | undefined;
    eventClient: EventClient | undefined;
    userUid: string | null;
    source: string;
    args: unknown;
}): Promise<PrivateLaunchDecision> {
    if (!app?.is_private) {
        return { hasAccess: true, checkedBy: 'core/public-app' };
    }
    if (!eventClient) {
        return buildDefaultDenied(
            app.name,
            'private-access-event-service-unavailable',
        );
    }

    const payload = {
        appUid: app.uid,
        appName: app.name,
        userUid,
        source,
        args,
        result: buildDefaultDenied(app.name, 'private-access-required'),
    };

    try {
        await eventClient.emitAndWait(
            'app.privateAccess.resolveLaunch',
            payload,
            {},
        );
    } catch {
        return buildDefaultDenied(app.name, 'private-access-check-error');
    }

    return normalize(payload.result, app.name);
}
