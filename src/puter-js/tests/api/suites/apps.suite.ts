import { suite } from '../harness/types.ts';

export default suite('apps', {
    'create registers an app retrievable by name': async (t) => {
        const app = await t.puter.apps.create(
            'apps-suite-create',
            'https://example.com/create',
        );
        t.assert.equal(app.name, 'apps-suite-create');
        const fetched = await t.puter.apps.get('apps-suite-create');
        t.assert.equal(fetched.index_url, 'https://example.com/create');
    },

    'create with an options object stores app metadata': async (t) => {
        const app = await t.puter.apps.create({
            name: 'apps-suite-meta',
            indexURL: 'https://example.com/meta',
            title: 'Metadata App',
            description: 'An app with rich metadata',
            maximizeOnStart: true,
        });
        t.assert.equal(app.title, 'Metadata App');
        const fetched = await t.puter.apps.get('apps-suite-meta');
        t.assert.equal(fetched.description, 'An app with rich metadata');
        t.assert.equal(Boolean(fetched.maximize_on_start), true);
    },

    'create without an index URL rejects': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.apps.create({ name: 'apps-suite-no-url' } as never),
            'create without indexURL should reject',
        );
    },

    'create with a duplicate name rejects': async (t) => {
        await t.puter.apps.create(
            'apps-suite-dup',
            'https://example.com/dup',
        );
        await t.assert.rejects(
            () =>
                t.puter.apps.create(
                    'apps-suite-dup',
                    'https://example.com/dup-2',
                ),
            'duplicate app name should reject',
        );
    },

    'list includes apps the user created': async (t) => {
        await t.puter.apps.create(
            'apps-suite-list',
            'https://example.com/list',
        );
        const apps = await t.puter.apps.list();
        t.assert.ok(
            apps.some((a) => a.name === 'apps-suite-list'),
            'created app should appear in list',
        );
    },

    'list pages with cursors and reports totals': async (t) => {
        const names = ['apps-suite-pg-a', 'apps-suite-pg-b', 'apps-suite-pg-c'];
        for (const name of names) {
            await t.puter.apps.create(name, `https://example.com/${name}`);
        }

        const firstPage = (await t.puter.apps.list({
            limit: 2,
            cursor: null,
            includeTotal: true,
        })) as {
            items: Array<{ name: string }>;
            cursor?: string;
            total?: number;
        };
        t.assert.ok(Array.isArray(firstPage.items), 'items should be an array');
        t.assert.ok(firstPage.items.length <= 2, 'page respects limit');
        t.assert.ok(
            (firstPage.total ?? 0) >= names.length,
            'total should count at least the created apps',
        );

        const seen: string[] = [];
        let cursor: string | null | undefined = null;
        do {
            const page = (await t.puter.apps.list({ limit: 2, cursor })) as {
                items: Array<{ name: string }>;
                cursor?: string;
            };
            seen.push(...page.items.map((a) => a.name));
            cursor = page.cursor;
        } while (cursor);
        for (const name of names) {
            t.assert.ok(seen.includes(name), `${name} should appear while paging`);
        }
    },

    'list with stream iterates pages via for await': async (t) => {
        const names = ['apps-suite-st-a', 'apps-suite-st-b', 'apps-suite-st-c'];
        for (const name of names) {
            await t.puter.apps.create(name, `https://example.com/${name}`);
        }

        const seen: string[] = [];
        let pages = 0;
        for await (const page of t.puter.apps.list({ stream: true, limit: 2 }) as AsyncIterable<{
            items: Array<{ name: string }>;
            cursor?: string;
        }>) {
            pages++;
            t.assert.ok(page.items.length <= 2, 'stream pages respect limit');
            seen.push(...page.items.map((a) => a.name));
        }
        t.assert.ok(pages >= 2, 'stream should yield multiple pages');
        for (const name of names) {
            t.assert.ok(seen.includes(name), `${name} should appear while streaming`);
        }
    },

    'update changes the index URL': async (t) => {
        await t.puter.apps.create(
            'apps-suite-update',
            'https://example.com/before',
        );
        const updated = await t.puter.apps.update('apps-suite-update', {
            indexURL: 'https://example.com/after',
        });
        t.assert.equal(updated.index_url, 'https://example.com/after');
    },

    'update changes title and description': async (t) => {
        await t.puter.apps.create(
            'apps-suite-update-meta',
            'https://example.com/update-meta',
        );
        const updated = await t.puter.apps.update('apps-suite-update-meta', {
            indexURL: 'https://example.com/update-meta',
            title: 'New Title',
            description: 'New description',
        });
        t.assert.equal(updated.title, 'New Title');
        t.assert.equal(updated.description, 'New description');
    },

    'get of an unknown app rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.apps.get('apps-suite-does-not-exist'),
            'get of an unknown app should reject',
        );
    },

    'delete removes the app': async (t) => {
        await t.puter.apps.create(
            'apps-suite-delete',
            'https://example.com/delete',
        );
        await t.puter.apps.delete('apps-suite-delete');
        await t.assert.rejects(
            () => t.puter.apps.get('apps-suite-delete'),
            'get of a deleted app should reject',
        );
    },

    'checkName distinguishes taken from available names': async (t) => {
        await t.puter.apps.create(
            'apps-suite-taken',
            'https://example.com/taken',
        );
        const taken = await t.puter.apps.checkName('apps-suite-taken');
        const available = await t.puter.apps.checkName(
            'apps-suite-surely-available',
        );
        t.assert.ok(
            JSON.stringify(taken) !== JSON.stringify(available),
            'taken and available names should report differently',
        );
    },

    'getDeveloperProfile returns a response': async (t) => {
        const profile = await t.puter.apps.getDeveloperProfile();
        t.assert.ok(
            profile && typeof profile === 'object',
            'developer profile should be an object',
        );
    },
});
