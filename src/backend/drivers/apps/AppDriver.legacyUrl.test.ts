import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import { PuterServer } from '../../server.js';
import { setupTestServer } from '../../testUtil.js';
import type { IConfig } from '../../types.js';

let server: PuterServer;

beforeAll(async () => {
    server = await setupTestServer({
        domain: 'puter.localhost',
        static_hosting_domain: 'site.puter.localhost',
        protocol: 'http',
    } as unknown as IConfig);
});

afterAll(async () => {
    await server?.shutdown();
});

type AppsDriver = {
    update: (args: {
        id: { name: string };
        object: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
};

describe('saving app settings with an unchanged legacy index_url', () => {
    it('allows saving an unchanged URL after its site is gone', async () => {
        const username = `li-${Math.random().toString(36).slice(2, 10)}`;
        const user = await server.stores.user.create({
            username,
            uuid: uuidv4(),
            password: null,
            email: `${username}@test.local`,
            free_storage: 100 * 1024 * 1024,
            requires_email_confirmation: false,
        } as Parameters<typeof server.stores.user.create>[0]);
        const actor = makeActor({
            user: { ...user, email_confirmed: true } as never,
        });
        const sub = `li-${Math.random().toString(36).slice(2, 8)}`;
        const legacyUrl = `http://${sub}.site.puter.localhost`;
        const name = `li-app-${Math.random().toString(36).slice(2, 8)}`;
        // Row as Dev Center wrote it before normalization: no trailing slash.
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [`app-${uuidv4()}`, name, 'Old title', legacyUrl, user.id],
        );
        const apps = server.drivers.apps as unknown as AppsDriver;

        // The site it pointed at has since been deleted.
        expect(await server.stores.subdomain.getBySubdomain(sub)).toBeFalsy();

        // Title-only save works.
        await runWithContext({ actor }, () =>
            apps.update({ id: { name }, object: { title: 'Title only' } }),
        );

        // Dev Center's save sends the stored index_url back as it was.
        await expect(
            runWithContext({ actor }, () =>
                apps.update({
                    id: { name },
                    object: { title: 'New title', index_url: legacyUrl },
                }),
            ),
        ).resolves.toMatchObject({ title: 'New title' });
        await expect(
            runWithContext({ actor }, () =>
                apps.update({
                    id: { name },
                    object: {
                        index_url: `http://different-${sub}.site.puter.localhost/`,
                    },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'subdomain_not_owned',
        });
    });

    it('normalizes a stored reserved host before comparing unchanged values', async () => {
        const user = await server.stores.user.create({
            username: `legacy-${uuidv4().slice(0, 8)}`,
            uuid: uuidv4(),
            password: null,
        });
        const actor = makeActor({ user });
        const name = `legacy-${uuidv4()}`;
        const indexUrl = 'https://builtins.namespaces.puter.com';
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [`app-${uuidv4()}`, name, 'Builtin', indexUrl, user.id],
        );
        const apps = server.drivers.apps as unknown as AppsDriver;
        await expect(
            runWithContext({ actor }, () =>
                apps.update({
                    id: { name },
                    object: { index_url: indexUrl, title: 'Saved' },
                }),
            ),
        ).resolves.toMatchObject({ title: 'Saved' });
        await expect(
            runWithContext({ actor }, () =>
                apps.update({
                    id: { name },
                    object: { index_url: `${indexUrl}/different` },
                }),
            ),
        ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('leaves a legacy mixed-case row as stored when re-sent normalized', async () => {
        const mkUser = async () => {
            const username = `lc-${Math.random().toString(36).slice(2, 10)}`;
            const user = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: `${username}@test.local`,
                free_storage: 100 * 1024 * 1024,
                requires_email_confirmation: false,
            } as Parameters<typeof server.stores.user.create>[0]);
            return {
                user,
                actor: makeActor({
                    user: { ...user, email_confirmed: true } as never,
                }),
            };
        };
        const owner = await mkUser();
        const siteOwner = await mkUser();
        const sub = `lc${Math.random().toString(36).slice(2, 8)}`;
        const otherSub = `lc${Math.random().toString(36).slice(2, 8)}`;
        for (const s of [sub, otherSub]) {
            const home = await server.services.fs.mkdir(siteOwner.user.id, {
                path: `/${siteOwner.user.username}/${s}`,
                createMissingParents: true,
            });
            await server.stores.subdomain.create({
                userId: siteOwner.user.id,
                subdomain: s,
                rootDirId: home.id,
            });
        }
        // Pre-normalization row pointing at a site now owned by someone else.
        const legacyUrl = `http://${sub.toUpperCase()}.site.puter.localhost`;
        const name = `lc-app-${uuidv4().slice(0, 8)}`;
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [`app-${uuidv4()}`, name, 'Old', legacyUrl, owner.user.id],
        );
        const apps = server.drivers.apps as unknown as AppsDriver;
        const readStored = async () => {
            const [row] = await server.clients.db.read(
                'SELECT index_url, title FROM apps WHERE name = ?',
                [name],
            );
            return row;
        };

        await runWithContext({ actor: owner.actor }, () =>
            apps.update({ id: { name }, object: { title: 'Title only' } }),
        );
        expect(await readStored()).toMatchObject({
            index_url: legacyUrl,
            title: 'Title only',
        });

        await runWithContext({ actor: owner.actor }, () =>
            apps.update({
                id: { name },
                object: {
                    title: 'Resent',
                    index_url: `http://${sub}.site.puter.localhost/`,
                },
            }),
        );
        expect(await readStored()).toMatchObject({
            index_url: legacyUrl,
            title: 'Resent',
        });

        await expect(
            runWithContext({ actor: owner.actor }, () =>
                apps.update({
                    id: { name },
                    object: {
                        index_url: `http://${otherSub}.site.puter.localhost/`,
                    },
                }),
            ),
        ).rejects.toMatchObject({
            statusCode: 400,
            legacyCode: 'subdomain_not_owned',
        });
        expect((await readStored()).index_url).toBe(legacyUrl);
    });

    it('leaves a legacy default-port reserved host as stored', async () => {
        const user = await server.stores.user.create({
            username: `legacy-${uuidv4().slice(0, 8)}`,
            uuid: uuidv4(),
            password: null,
        });
        const actor = makeActor({ user });
        const name = `legacy-${uuidv4()}`;
        const indexUrl = 'https://PUTER.COM:443';
        await server.clients.db.write(
            'INSERT INTO `apps` (`uid`, `name`, `title`, `index_url`, `owner_user_id`) VALUES (?, ?, ?, ?, ?)',
            [`app-${uuidv4()}`, name, 'Builtin', indexUrl, user.id],
        );
        const apps = server.drivers.apps as unknown as AppsDriver;
        await expect(
            runWithContext({ actor }, () =>
                apps.update({
                    id: { name },
                    object: { index_url: 'https://puter.com/', title: 'Saved' },
                }),
            ),
        ).resolves.toMatchObject({ title: 'Saved' });
        const [row] = await server.clients.db.read(
            'SELECT index_url FROM apps WHERE name = ?',
            [name],
        );
        expect(row.index_url).toBe(indexUrl);
    });
});
