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

import type { Actor } from '../../core/actor.js';

/** The scope columns of a `notification` row. */
export interface NotificationRowScope {
    audience: string;
    appUid: string | null;
}

/**
 * Audiences an actor holding an app can ever be shown, and therefore the only
 * ones worth querying for it. `account` is absent by construction — the SQL
 * scope and the predicate have to agree on that, or one of them is decorative.
 */
export const APP_READABLE_AUDIENCES: readonly string[] = Object.freeze([
    'app-user',
    'developer',
]);

export interface NotificationVisibilityFacts {
    /**
     * Whether the row's recipient owns the app it names — the `developer`
     * audience is the app owner's, so nothing else may read it. Absent denies,
     * so a caller that cannot answer it gets no developer rows.
     */
    recipientOwnsApp?: boolean;
}

/**
 * Whether an actor may see one row of a recipient's mailbox. Scoping to the
 * recipient is the caller's job; this decides audience only.
 *
 * Default-deny by audience rather than a filter applied afterwards: an
 * `account` row — email changed, card verified, an abuse block — must never
 * reach an actor acting as an app, and no grant overrides that. `developer`
 * rows are the app owner's; an ordinary app token asking for them gets nothing
 * back rather than a refusal, because the app roster is not an oracle.
 *
 * Reads `effectiveApp`, so an access token issued by an app is treated as that
 * app; `undefined` means the actor never went through `makeActor` and is denied
 * rather than read as "no app".
 */
export const canViewNotification = (
    scope: NotificationRowScope,
    actor: Pick<Actor, 'effectiveApp'>,
    facts: NotificationVisibilityFacts = {},
): boolean => {
    if (actor.effectiveApp === undefined) return false;
    const viewingApp = actor.effectiveApp?.uid ?? null;

    if (scope.audience === 'account') return viewingApp === null;
    if (scope.audience !== 'developer' && scope.audience !== 'app-user') {
        return false;
    }

    // An app-scoped audience on a row naming no app: legacy worker rows, and
    // deploys of a worker bound to no app. It is the recipient's, and no
    // app's.
    if (!scope.appUid) return viewingApp === null;

    if (viewingApp !== null && viewingApp !== scope.appUid) return false;
    return scope.audience === 'app-user' || facts.recipientOwnsApp === true;
};

/** The predicate's input, read off a stored row. */
export const notificationRowScope = (
    row: Record<string, unknown>,
): NotificationRowScope => ({
    audience: String(row.audience ?? 'account'),
    appUid: (row.app_uid as string | null) ?? null,
});

/** The `apps` lookup the developer-audience fact needs. */
export interface AppOwnerLookup {
    getByUids: (
        uids: string[],
    ) => Promise<Map<string, { owner_user_id?: unknown } | undefined>>;
}

/**
 * Which of `appUids` the recipient owns — the fact `developer` rows turn on. A
 * lookup that fails owns nothing, so the audience stays denied.
 */
export const ownedAppUids = async (
    apps: AppOwnerLookup,
    userId: number,
    appUids: readonly string[],
): Promise<Set<string>> => {
    const wanted = [...new Set(appUids.filter((uid) => !!uid))];
    if (wanted.length === 0) return new Set();
    try {
        const found = await apps.getByUids(wanted);
        return new Set(
            wanted.filter(
                (uid) =>
                    Number(found.get(uid)?.owner_user_id) === Number(userId),
            ),
        );
    } catch {
        return new Set();
    }
};
