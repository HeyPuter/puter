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

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';

// ── Test harness ────────────────────────────────────────────────────
//
// `SuggestedAppsService` produces launch metadata that the GUI's
// default-open path (`open_item` → `launch_app({ app_obj })`) consumes
// *without* re-reading the app through AppDriver. That makes it a
// launch-metadata producer in its own right, so it carries the same
// hosted-backing guard — these tests pin that.

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer();
});

afterAll(async () => {
    await server?.shutdown();
});

const uniqueName = (prefix: string) =>
    `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const hostedUrl = (sub: string) => `https://${sub}.site.puter.localhost/`;

const makeUser = async (): Promise<{ userId: number }> => {
    const username = `sa-${Math.random().toString(36).slice(2, 10)}`;
    const created = await server.stores.user.create({
        username,
        uuid: uuidv4(),
        password: null,
        email: `${username}@test.local`,
        free_storage: 100 * 1024 * 1024,
        requires_email_confirmation: false,
    });
    return { userId: created.id };
};

/**
 * Creates an app row already approved for opening items and associated
 * with `ext` — that pairing is what puts a third-party app into the
 * suggested list. `approved_for_opening_items` is in the store's
 * read-only column set (it's an admin decision, not a dev-settable
 * field), so set it with a direct write rather than through `create`.
 */
const makeOpenerApp = async ({
    userId,
    indexUrl,
    ext,
}: {
    userId: number;
    indexUrl: string;
    ext: string;
}): Promise<string> => {
    const name = uniqueName('opener');
    const app = await server.stores.app.create(
        { name, title: 'Opener', index_url: indexUrl },
        { ownerUserId: userId },
    );
    const appId = (app as { id: number }).id;
    await server.clients.db.write(
        'UPDATE `apps` SET `approved_for_opening_items` = 1 WHERE `id` = ?',
        [appId],
    );
    // Stored verbatim and matched exactly against the bare, lowercased
    // extension `SuggestedAppsService` derives from the filename.
    await server.stores.app.setFiletypeAssociations(appId, [ext]);
    return name;
};

/**
 * Points a built-in opener app at `indexUrl`, creating the row if this
 * environment didn't seed it. Some built-in names ship in the default-apps
 * migration and some don't, so neither create nor update is safe alone.
 */
const pointBuiltinAt = async (
    name: string,
    userId: number,
    indexUrl: string,
): Promise<void> => {
    const existing = await server.stores.app.getByName(name);
    if (existing) {
        await server.stores.app.update((existing as { id: number }).id, {
            index_url: indexUrl,
        });
        await server.clients.db.write(
            'UPDATE `apps` SET `owner_user_id` = ? WHERE `id` = ?',
            [userId, (existing as { id: number }).id],
        );
        return;
    }
    await server.stores.app.create(
        { name, title: name, index_url: indexUrl },
        { ownerUserId: userId },
    );
};

const suggestFor = async (ext: string): Promise<Array<{ name?: unknown }>> =>
    (await server.services.suggestedApps.getSuggestedApps({
        name: `file.${ext}`,
        path: `/x/file.${ext}`,
    })) as Array<{ name?: unknown }>;

describe('SuggestedAppsService hosted-backing guard', () => {
    it('suggests an opener app while its hosted subdomain is owned', async () => {
        const { userId } = await makeUser();
        const ext = uniqueName('ext1').replace(/-/g, '');
        const sub = uniqueName('live');
        await server.stores.subdomain.create({ userId, subdomain: sub });

        const name = await makeOpenerApp({
            userId,
            indexUrl: hostedUrl(sub),
            ext,
        });

        const suggested = await suggestFor(ext);
        const entry = suggested.find((a) => a.name === name) as
            | { index_url?: unknown }
            | undefined;
        expect(entry).toBeDefined();
        expect(String(entry?.index_url)).toContain(sub);
    });

    it('drops an opener app whose hosted subdomain was deleted', async () => {
        const { userId } = await makeUser();
        const ext = uniqueName('ext2').replace(/-/g, '');
        const sub = uniqueName('gone');
        const row = await server.stores.subdomain.create({
            userId,
            subdomain: sub,
        });

        const name = await makeOpenerApp({
            userId,
            indexUrl: hostedUrl(sub),
            ext,
        });

        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId },
        );

        const suggested = await suggestFor(ext);
        expect(suggested.find((a) => a.name === name)).toBeUndefined();
    });

    it('drops an opener app whose hosted subdomain was reclaimed by another user', async () => {
        const owner = await makeUser();
        const attacker = await makeUser();
        const ext = uniqueName('ext3').replace(/-/g, '');
        const sub = uniqueName('reclaim');
        const row = await server.stores.subdomain.create({
            userId: owner.userId,
            subdomain: sub,
        });

        const name = await makeOpenerApp({
            userId: owner.userId,
            indexUrl: hostedUrl(sub),
            ext,
        });

        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId: owner.userId },
        );
        await server.stores.subdomain.create({
            userId: attacker.userId,
            subdomain: sub,
        });

        const suggested = await suggestFor(ext);
        expect(suggested.find((a) => a.name === name)).toBeUndefined();
    });

    it('leaves apps on non-hosted index_urls alone', async () => {
        const { userId } = await makeUser();
        const ext = uniqueName('ext4').replace(/-/g, '');

        const name = await makeOpenerApp({
            userId,
            indexUrl: 'https://someone-elses-domain.example/',
            ext,
        });

        const suggested = await suggestFor(ext);
        expect(suggested.find((a) => a.name === name)).toBeDefined();
    });

    it('fails closed when the subdomain lookup errors', async () => {
        const { userId } = await makeUser();
        const ext = uniqueName('ext5').replace(/-/g, '');
        const sub = uniqueName('flaky');
        await server.stores.subdomain.create({ userId, subdomain: sub });

        const name = await makeOpenerApp({
            userId,
            indexUrl: hostedUrl(sub),
            ext,
        });

        // A store failure must not be read as "backing is fine" — an
        // unverifiable app is withheld rather than handed to the launcher.
        const spy = vi
            .spyOn(server.stores.subdomain, 'getBySubdomain')
            .mockRejectedValue(new Error('db down'));
        try {
            const suggested = await suggestFor(ext);
            expect(suggested.find((a) => a.name === name)).toBeUndefined();
        } finally {
            spy.mockRestore();
        }
    });

    it('applies the guard on the batched multi-entry path too', async () => {
        // `readdir` fans out through `getSuggestedAppsForEntries`, a
        // separate entry point from `getSuggestedApps`. Both must gate.
        const { userId } = await makeUser();
        const liveExt = uniqueName('ext6').replace(/-/g, '');
        const deadExt = uniqueName('ext7').replace(/-/g, '');

        const liveSub = uniqueName('live');
        await server.stores.subdomain.create({ userId, subdomain: liveSub });
        const liveName = await makeOpenerApp({
            userId,
            indexUrl: hostedUrl(liveSub),
            ext: liveExt,
        });

        const deadSub = uniqueName('dead');
        const deadRow = await server.stores.subdomain.create({
            userId,
            subdomain: deadSub,
        });
        const deadName = await makeOpenerApp({
            userId,
            indexUrl: hostedUrl(deadSub),
            ext: deadExt,
        });
        await server.stores.subdomain.deleteByUuid(
            String((deadRow as { uuid: string }).uuid),
            { userId },
        );

        const [liveResult, deadResult] = (await server.services.suggestedApps.getSuggestedAppsForEntries(
            [{ name: `a.${liveExt}` }, { name: `b.${deadExt}` }],
        )) as Array<Array<{ name?: unknown }>>;

        expect(liveResult.find((a) => a.name === liveName)).toBeDefined();
        expect(deadResult.find((a) => a.name === deadName)).toBeUndefined();
    });

    // Built-ins enter the list by stable name rather than through
    // `app_filetype_association`, which is a separate loop. In prod their
    // index_urls aren't puter-hosted, but nothing structurally prevents it
    // — so the guard has to cover that branch too. Split across two
    // extensions because the per-extension cache would otherwise serve the
    // first call's result to the second.

    it('keeps a built-in-name opener whose hosted backing is live', async () => {
        const { userId } = await makeUser();
        const sub = uniqueName('builtinlive');
        await server.stores.subdomain.create({ userId, subdomain: sub });
        // 'markus' is the first built-in opener mapped to `.md`.
        await pointBuiltinAt('markus', userId, hostedUrl(sub));

        expect((await suggestFor('md')).map((a) => a.name)).toContain('markus');
    });

    it('drops a built-in-name opener whose hosted backing is gone', async () => {
        const { userId } = await makeUser();
        const sub = uniqueName('builtindead');
        const row = await server.stores.subdomain.create({
            userId,
            subdomain: sub,
        });
        // 'pdf' is the sole built-in opener mapped to `.pdf`.
        await pointBuiltinAt('pdf', userId, hostedUrl(sub));
        await server.stores.subdomain.deleteByUuid(
            String((row as { uuid: string }).uuid),
            { userId },
        );

        expect((await suggestFor('pdf')).map((a) => a.name)).not.toContain(
            'pdf',
        );
    });

    it('does not cache a failed resolve, so the next call retries', async () => {
        // The per-extension cache holds the in-flight promise. A resolve
        // that throws must drop its entry — otherwise one transient app
        // store failure would withhold an app's suggestions for the full
        // 5-minute TTL.
        const { userId } = await makeUser();
        const ext = uniqueName('ext9').replace(/-/g, '');
        const name = await makeOpenerApp({
            userId,
            indexUrl: 'https://dev-owned-domain.example/',
            ext,
        });

        const spy = vi
            .spyOn(server.stores.app, 'getAppsByFiletype')
            .mockRejectedValue(new Error('db down'));
        await expect(suggestFor(ext)).rejects.toThrow('db down');
        spy.mockRestore();

        const suggested = await suggestFor(ext);
        expect(suggested.find((a) => a.name === name)).toBeDefined();
    });

    it('ranks a registered app ahead of the editor fallback for unknown extensions', async () => {
        // For extensions with no intentional built-in mapping, `editor` is
        // only a guess — and `suggested[0]` is what double-click and
        // `/open_item` launch. An app that explicitly registered the
        // extension must take the head slot or binary files open as
        // plain text.
        const { userId } = await makeUser();
        const ext = uniqueName('ext10').replace(/-/g, '');
        await pointBuiltinAt('editor', userId, 'https://editor.example.com/');
        const name = await makeOpenerApp({
            userId,
            indexUrl: 'https://dev-owned-domain.example/',
            ext,
        });

        const names = (await suggestFor(ext)).map((a) => a.name);
        expect(names[0]).toBe(name);
        expect(names).toContain('editor');
    });

    it('keeps built-ins first for intentionally mapped extensions', async () => {
        // `.txt` → editor is a deliberate mapping, not the fallback guess;
        // a third-party association must not displace it.
        const { userId } = await makeUser();
        await pointBuiltinAt('editor', userId, 'https://editor.example.com/');
        const name = await makeOpenerApp({
            userId,
            indexUrl: 'https://dev-owned-domain.example/',
            ext: 'txt',
        });

        const names = (await suggestFor('txt')).map((a) => a.name);
        expect(names[0]).toBe('editor');
        expect(names).toContain(name);
    });

    it('does not hit the subdomain store for non-hosted index_urls', async () => {
        // Built-ins and apps on a developer's own domain aren't on a
        // hosting domain, so the guard short-circuits on the URL alone.
        // This keeps the check off the readdir hot path — a regression
        // here would add a DB round-trip per suggested app, per extension.
        const { userId } = await makeUser();
        const ext = uniqueName('ext8').replace(/-/g, '');
        const name = await makeOpenerApp({
            userId,
            indexUrl: 'https://dev-owned-domain.example/',
            ext,
        });

        const spy = vi.spyOn(server.stores.subdomain, 'getBySubdomain');
        try {
            const suggested = await suggestFor(ext);
            expect(suggested.find((a) => a.name === name)).toBeDefined();
            expect(spy).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });
});
