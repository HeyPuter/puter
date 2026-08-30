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

/**
 * `GET /events/fetch` — catching up on what a disconnect missed.
 *
 * The cases that matter are the ones a client cannot check for itself: that a
 * page is a real keyset (no repeats, no skips), that the answer is the same
 * whatever region asked, that nothing is written, and that no parameter shape
 * reaches another account's mailbox.
 */

import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let userId: number;
let userUuid: string;
let otherId: number;
let appUid: string;
let appToken: string;
let otherAppUid: string;

interface ApiResponse {
    status: number;
    body: {
        items?: Array<Record<string, unknown>>;
        cursor?: string;
        code?: string;
        [key: string]: unknown;
    };
}

const fetchPage = async (
    token: string,
    query: Record<string, string | number | undefined>,
): Promise<ApiResponse> => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        search.set(key, String(value));
    }
    const response = await fetch(
        new URL(`/events/fetch?${search.toString()}`, env.apiOrigin),
        { headers: { authorization: `Bearer ${token}` } },
    );
    return {
        status: response.status,
        body: (await response.json()) as ApiResponse['body'],
    };
};

/** A row written straight in, so its scope is fixture rather than policy. */
const seed = async (
    forUserId: number,
    value: Record<string, unknown>,
    scope: { audience?: string; appUid?: string | null } = {},
): Promise<string> => {
    const row = await env.server.stores.notification.create({
        userId: forUserId,
        value,
        type: 'share.received',
        audience: scope.audience ?? 'account',
        appUid: scope.appUid ?? null,
    });
    return row.uid as string;
};

const uidsOf = (response: ApiResponse): string[] =>
    (response.body.items ?? []).map((item) => String(item.uid));

const clearMailboxes = async (): Promise<void> => {
    await env.server.clients.db.write('DELETE FROM `notification`', []);
};

beforeAll(async () => {
    env = await setupPuterTestEnv({
        events: { enabled: true },
        unlimitedMetering: true,
    } as IConfig);

    const user = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    userId = user!.id;
    userUuid = user!.uuid;
    const other = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    otherId = other!.id;

    const actor = await env.server.services.auth.authenticate(
        env.users.user.token,
    );
    appUid = `app-${uuidv4()}`;
    otherAppUid = `app-${uuidv4()}`;
    for (const uid of [appUid, otherAppUid]) {
        await env.server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [uid, uid, uid, `https://${uid}.example/`, userId],
        );
    }
    appToken = await env.server.services.auth.getUserAppToken(
        actor.actor!,
        appUid,
    );
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('fetching a mailbox slice', () => {
    it('returns what was missed, oldest first, in the delivered shape', async () => {
        await clearMailboxes();
        const first = await seed(userId, { title: 'one' });
        const second = await seed(userId, { title: 'two' });

        const page = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
        });

        expect(page.status).toBe(200);
        expect(uidsOf(page)).toEqual([first, second]);
        expect(page.body.items![0]).toEqual({
            id: first,
            subject: `notif:${userUuid}:account`,
            op: 'post',
            uid: first,
            type: 'share.received',
            audience: 'account',
            appUid: null,
            notification: { title: 'one' },
            self: true,
            ts: expect.any(Number),
            seq: 0,
        });
    });

    it('pages forward from the cursor and never repeats a row', async () => {
        await clearMailboxes();
        const uids: string[] = [];
        for (let i = 0; i < 5; i++) uids.push(await seed(userId, { i }));

        const first = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
            limit: 2,
        });
        expect(uidsOf(first)).toEqual(uids.slice(0, 2));
        expect(first.body.cursor).toBeTruthy();

        const second = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
            limit: 2,
            after: first.body.cursor,
        });
        expect(uidsOf(second)).toEqual(uids.slice(2, 4));

        const third = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
            limit: 2,
            after: second.body.cursor,
        });
        expect(uidsOf(third)).toEqual(uids.slice(4));
        // A page that ends the list carries no cursor to follow.
        expect(third.body.cursor).toBeUndefined();

        // A row written after the last page is what the next fetch returns,
        // and only that row.
        const late = await seed(userId, { title: 'late' });
        const after = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
            after: second.body.cursor,
        });
        expect(uidsOf(after)).toEqual([uids[4], late]);
    });

    it('writes nothing — a fetch is a read, twice over', async () => {
        await clearMailboxes();
        await seed(userId, { title: 'unread' });

        const write = vi.spyOn(env.server.clients.db, 'write');
        const page = await fetchPage(env.users.user.token, {
            subject: 'notif:account',
        });
        expect(page.status).toBe(200);
        expect(write).not.toHaveBeenCalled();
        write.mockRestore();

        // Still unseen: catching up is not the same as having seen it.
        const rows = await env.server.stores.notification.listByUserId(userId, {
            filter: 'unseen',
        });
        expect(rows).toHaveLength(1);
    });

    it('refuses a subject family with no store behind it', async () => {
        for (const subject of ['fs:/some/path', 'kv:cart']) {
            const page = await fetchPage(env.users.user.token, { subject });
            expect(page.status).toBe(400);
            expect(page.body.code).toBe('fetch_unsupported_subject');
        }
    });

    it('rejects a malformed or unknown notif subject', async () => {
        const bad = await fetchPage(env.users.user.token, {
            subject: 'notif:everyone',
        });
        expect(bad.status).toBe(400);
        expect(bad.body.code).toBe('invalid_subject_audience');

        const empty = await fetchPage(env.users.user.token, { subject: '' });
        expect(empty.status).toBe(400);
        expect(empty.body.code).toBe('invalid_subject');
    });
});

describe('who a fetch may see', () => {
    it('never hands an app token an account row', async () => {
        await clearMailboxes();
        await seed(userId, { title: 'account only' });
        await seed(userId, { title: 'app row' }, {
            audience: 'app-user',
            appUid,
        });

        const asAccount = await fetchPage(appToken, {
            subject: `notif:${userUuid}:account`,
        });
        expect(asAccount.status).toBe(200);
        expect(asAccount.body.items).toEqual([]);

        // Its own rows it does see, without naming its own uid.
        const own = await fetchPage(appToken, { subject: 'notif:app-user' });
        expect(own.body.items).toHaveLength(1);
        expect(own.body.items![0]).toMatchObject({
            audience: 'app-user',
            appUid,
        });
    });

    it('answers empty for another app\'s rows rather than saying they exist', async () => {
        await clearMailboxes();
        await seed(userId, { title: 'other app' }, {
            audience: 'app-user',
            appUid: otherAppUid,
        });

        const page = await fetchPage(appToken, {
            subject: `notif:${otherAppUid}:app-user`,
        });
        expect(page.status).toBe(200);
        expect(page.body.items).toEqual([]);
    });

    it('shows developer rows to the app owner and the account', async () => {
        await clearMailboxes();
        const uid = await seed(userId, { title: 'deploy failed' }, {
            audience: 'developer',
            appUid,
        });

        const asOwner = await fetchPage(env.users.user.token, {
            subject: `notif:${appUid}:developer`,
        });
        expect(uidsOf(asOwner)).toEqual([uid]);

        // The app's own token holds the owner's mailbox here, so the rows are
        // reachable through it too — the check is who the recipient is.
        const asApp = await fetchPage(appToken, {
            subject: 'notif:developer',
        });
        expect(uidsOf(asApp)).toEqual([uid]);
    });
});

describe('cross-user isolation', () => {
    it('returns nothing of another account, whatever the subject names', async () => {
        await clearMailboxes();
        const mine = await seed(userId, { title: 'mine' });
        await seed(otherId, { title: 'theirs' });
        await seed(otherId, { title: 'their app row' }, {
            audience: 'app-user',
            appUid,
        });

        // Naming the other user's uuid, their app scope, or nothing at all:
        // the query is keyed on the caller, so none of it reaches across.
        const other = await env.server.stores.user.getByUsername(
            env.users.other.username,
        );
        for (const subject of [
            'notif:account',
            `notif:${other!.uuid}:account`,
            `notif:${appUid}:app-user`,
        ]) {
            const page = await fetchPage(env.users.user.token, { subject });
            expect(page.status).toBe(200);
            for (const item of page.body.items ?? [])
                expect([mine]).toContain(String(item.uid));
        }

        const theirs = await fetchPage(env.users.other.token, {
            subject: 'notif:account',
        });
        expect(uidsOf(theirs)).not.toContain(mine);
    });
});

describe('fetch with events disabled', () => {
    it('answers `events_disabled` rather than reading the mailbox', async () => {
        const off = await setupPuterTestEnv({} as IConfig);
        try {
            const response = await fetch(
                new URL('/events/fetch?subject=notif:account', off.apiOrigin),
                {
                    headers: {
                        authorization: `Bearer ${off.users.user.token}`,
                    },
                },
            );
            expect(response.status).toBe(503);
            expect(((await response.json()) as { code?: string }).code).toBe(
                'events_disabled',
            );
        } finally {
            await off.shutdown();
        }
    }, BOOT_TIMEOUT_MS);
});
