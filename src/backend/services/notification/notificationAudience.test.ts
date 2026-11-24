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

import { describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import type { Actor } from '../../core/actor.js';
import {
    canViewNotification,
    visibleNotificationRows,
} from './notificationAudience.js';

const OWN_APP = 'app-11111111-1111-4111-8111-111111111111';
const OTHER_APP = 'app-22222222-2222-4222-8222-222222222222';

const user = { uuid: 'user-uuid', username: 'holder', id: 7 };

/** A plain web session: no app anywhere in the chain. */
const session = makeActor({ user });

/** An app-under-user token. */
const appUnderUser = makeActor({ user, app: { uid: OWN_APP, id: 1 } });

/** An access token an app minted: its app arrives through the issuer. */
const appIssuedToken = makeActor({
    user,
    accessToken: { uid: 'tok-app', issuer: appUnderUser },
});

/** An access token a plain session minted: still no app. */
const userIssuedToken = makeActor({
    user,
    accessToken: { uid: 'tok-user', issuer: session },
});

/** Never went through `makeActor`, so `effectiveApp` was never derived. */
const unresolved = { user } as Actor;

const owns = { recipientOwnsApp: true };

describe('canViewNotification — account rows', () => {
    const account = { audience: 'account', appUid: null };

    it('reaches a session and a token that session issued', () => {
        expect(canViewNotification(account, session)).toBe(true);
        expect(canViewNotification(account, userIssuedToken)).toBe(true);
    });

    it('never reaches an actor acting as an app', () => {
        expect(canViewNotification(account, appUnderUser)).toBe(false);
        // The access token carries no `app` of its own — the app it acts as
        // arrives through the issuer chain, and reading `app` would let it
        // through.
        expect(appIssuedToken.app).toBeUndefined();
        expect(appIssuedToken.effectiveApp?.uid).toBe(OWN_APP);
        expect(canViewNotification(account, appIssuedToken)).toBe(false);
    });

    it('is not overridable by ownership', () => {
        expect(canViewNotification(account, appUnderUser, owns)).toBe(false);
    });

    it('denies an actor whose app was never resolved', () => {
        expect(canViewNotification(account, unresolved)).toBe(false);
    });
});

describe('canViewNotification — developer rows', () => {
    const own = { audience: 'developer', appUid: OWN_APP };

    it('reaches the owner session and the app itself', () => {
        expect(canViewNotification(own, session, owns)).toBe(true);
        expect(canViewNotification(own, appUnderUser, owns)).toBe(true);
        expect(canViewNotification(own, appIssuedToken, owns)).toBe(true);
    });

    it('is empty rather than an error for a holder who does not own the app', () => {
        expect(canViewNotification(own, session)).toBe(false);
        expect(canViewNotification(own, appUnderUser)).toBe(false);
        expect(canViewNotification(own, appIssuedToken)).toBe(false);
    });

    it('never crosses to another app', () => {
        const other = { audience: 'developer', appUid: OTHER_APP };
        expect(canViewNotification(other, appUnderUser, owns)).toBe(false);
        expect(canViewNotification(other, appIssuedToken, owns)).toBe(false);
        // The owning user still sees it from a session.
        expect(canViewNotification(other, session, owns)).toBe(true);
    });

    it('treats a row naming no app as the recipient own', () => {
        const unattributed = { audience: 'developer', appUid: null };
        expect(canViewNotification(unattributed, session)).toBe(true);
        expect(canViewNotification(unattributed, userIssuedToken)).toBe(true);
        expect(canViewNotification(unattributed, appUnderUser, owns)).toBe(
            false,
        );
        expect(canViewNotification(unattributed, appIssuedToken, owns)).toBe(
            false,
        );
    });

    it('denies an actor whose app was never resolved', () => {
        expect(canViewNotification(own, unresolved, owns)).toBe(false);
    });
});

describe('canViewNotification — app-user rows', () => {
    const own = { audience: 'app-user', appUid: OWN_APP };

    it('reaches the user session and the app it is about, ownership aside', () => {
        expect(canViewNotification(own, session)).toBe(true);
        expect(canViewNotification(own, appUnderUser)).toBe(true);
        expect(canViewNotification(own, appIssuedToken)).toBe(true);
    });

    it('never crosses to another app', () => {
        const other = { audience: 'app-user', appUid: OTHER_APP };
        expect(canViewNotification(other, appUnderUser)).toBe(false);
        expect(canViewNotification(other, appIssuedToken)).toBe(false);
        expect(canViewNotification(other, session)).toBe(true);
    });

    it('denies an actor whose app was never resolved', () => {
        expect(canViewNotification(own, unresolved)).toBe(false);
    });

    it('treats a row naming no app as the recipient`s own, and no app`s', () => {
        // A subscription a plain session made and then lost holds no app —
        // the row is the holder's own, exactly like an unattributed
        // `developer` row, and no app may read it in its place.
        const unattributed = { audience: 'app-user', appUid: null };
        expect(canViewNotification(unattributed, session)).toBe(true);
        expect(canViewNotification(unattributed, userIssuedToken)).toBe(true);
        expect(canViewNotification(unattributed, appUnderUser)).toBe(false);
        expect(canViewNotification(unattributed, appIssuedToken)).toBe(false);
    });
});

describe('canViewNotification — unknown audiences', () => {
    it('denies an audience nothing registers', () => {
        for (const actor of [session, appUnderUser, appIssuedToken]) {
            expect(
                canViewNotification(
                    { audience: 'everyone', appUid: null },
                    actor,
                    owns,
                ),
            ).toBe(false);
            expect(
                canViewNotification({ audience: '', appUid: OWN_APP }, actor, owns),
            ).toBe(false);
        }
    });
});

describe('visibleNotificationRows', () => {
    const rows = [
        { uid: 'account', audience: 'account', app_uid: null },
        { uid: 'mine-dev', audience: 'developer', app_uid: OWN_APP },
        { uid: 'other-dev', audience: 'developer', app_uid: OTHER_APP },
        { uid: 'mine-user', audience: 'app-user', app_uid: OWN_APP },
    ];

    /** Only `OWN_APP` belongs to the recipient; counts the lookups. */
    const appsOwnedBy = (ownerId: number) => {
        const asked: string[][] = [];
        return {
            asked,
            getByUids: async (uids: string[]) => {
                asked.push(uids);
                return new Map(
                    uids.map((uid) => [
                        uid,
                        { owner_user_id: uid === OWN_APP ? ownerId : 99 },
                    ]),
                );
            },
        };
    };

    it('keeps what a session may see, resolving ownership in one lookup', async () => {
        const apps = appsOwnedBy(user.id);
        const visible = await visibleNotificationRows(apps, session, rows);
        expect(visible.map((row) => row.uid)).toEqual([
            'account',
            'mine-dev',
            'mine-user',
        ]);
        expect(apps.asked).toEqual([[OWN_APP, OTHER_APP]]);
    });

    it('confines an app to its own rows', async () => {
        const visible = await visibleNotificationRows(
            appsOwnedBy(user.id),
            appUnderUser,
            rows,
        );
        expect(visible.map((row) => row.uid)).toEqual(['mine-dev', 'mine-user']);
    });

    it('asks nothing for an empty page', async () => {
        const apps = appsOwnedBy(user.id);
        expect(await visibleNotificationRows(apps, session, [])).toEqual([]);
        expect(apps.asked).toEqual([]);
    });
});
