/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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

import { UserActorType } from '../../services/auth/Actor.js';

const DEFAULT_FALLBACK_APP_NAME = 'app-center';

function isPrivateApp (app) {
    return Number(app?.is_private ?? 0) > 0;
}

function buildFallbackPath (appName) {
    if ( typeof appName !== 'string' || !appName.trim() ) {
        return '/app';
    }
    return `/app/${encodeURIComponent(appName.trim())}`;
}

function buildDefaultDeniedDecision (appName, reason) {
    return {
        hasAccess: false,
        fallbackAppName: DEFAULT_FALLBACK_APP_NAME,
        fallbackArgs: {
            path: buildFallbackPath(appName),
        },
        reason: reason ?? 'private-access-required',
        checkedBy: 'core/private-launch-access',
    };
}

function normalizeLaunchDecision (decision, appName) {
    if ( !decision || typeof decision !== 'object' ) {
        return buildDefaultDeniedDecision(appName, 'invalid-private-access-result');
    }

    const hasAccess = !!decision.hasAccess;
    if ( hasAccess ) {
        return {
            hasAccess: true,
            reason: typeof decision.reason === 'string'
                ? decision.reason
                : undefined,
            checkedBy: typeof decision.checkedBy === 'string'
                ? decision.checkedBy
                : undefined,
        };
    }

    const fallbackAppName = typeof decision.fallbackAppName === 'string'
        && decision.fallbackAppName.trim()
        ? decision.fallbackAppName.trim()
        : DEFAULT_FALLBACK_APP_NAME;
    const fallbackPath = decision.fallbackArgs?.path;
    const fallbackArgs = typeof fallbackPath === 'string' && fallbackPath.trim()
        ? { path: fallbackPath.trim() }
        : { path: buildFallbackPath(appName) };

    return {
        hasAccess: false,
        fallbackAppName,
        fallbackArgs,
        reason: typeof decision.reason === 'string'
            ? decision.reason
            : undefined,
        checkedBy: typeof decision.checkedBy === 'string'
            ? decision.checkedBy
            : undefined,
    };
}

function getActorUserUid (actor) {
    if ( ! actor ) return null;

    if ( actor.type instanceof UserActorType ) {
        const userUid = actor.type?.user?.uuid;
        return typeof userUid === 'string' && userUid ? userUid : null;
    }

    if ( typeof actor.get_related_actor === 'function' ) {
        try {
            const userActor = actor.get_related_actor(UserActorType);
            const userUid = userActor?.type?.user?.uuid;
            return typeof userUid === 'string' && userUid ? userUid : null;
        } catch {
            return null;
        }
    }

    return null;
}

async function resolvePrivateLaunchAccess ({
    app,
    services,
    userUid,
    source,
    args,
}) {
    if ( ! isPrivateApp(app) ) {
        return {
            hasAccess: true,
            checkedBy: 'core/public-app',
        };
    }

    const deniedDecision = buildDefaultDeniedDecision(
        app?.name,
        'private-access-required',
    );

    const eventService = services?.get?.('event');
    if ( ! eventService ) {
        return {
            ...deniedDecision,
            reason: 'private-access-event-service-unavailable',
        };
    }

    const eventPayload = {
        appUid: app?.uid,
        appName: app?.name,
        userUid: typeof userUid === 'string' && userUid ? userUid : null,
        source: source ?? 'unknown',
        args: args ?? {},
        result: { ...deniedDecision },
    };

    try {
        await eventService.emit('app.privateAccess.resolveLaunch', eventPayload);
    } catch {
        return {
            ...deniedDecision,
            reason: 'private-access-check-error',
        };
    }

    return normalizeLaunchDecision(eventPayload.result, app?.name);
}

export {
    getActorUserUid,
    isPrivateApp,
    resolvePrivateLaunchAccess,
};
