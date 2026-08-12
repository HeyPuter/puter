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

    'feedbackEnabled round-trips on create and survives an unrelated update':
        async (t) => {
            // Mirrors Dev Center: create with feedback on, then a Save-style
            // update that omits feedbackEnabled must not clear it.
            const created = await t.puter.apps.create({
                name: 'apps-suite-feedback',
                indexURL: 'https://example.com/feedback',
                feedbackEnabled: true,
            });
            t.assert.equal(Boolean(created.feedback_enabled), true);

            const updated = await t.puter.apps.update('apps-suite-feedback', {
                title: 'Feedback App',
            });
            t.assert.equal(Boolean(updated.feedback_enabled), true);

            const disabled = await t.puter.apps.update('apps-suite-feedback', {
                feedbackEnabled: false,
            });
            t.assert.equal(Boolean(disabled.feedback_enabled), false);
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

    'create validates client-side with a backward-compatible error shape': async (t) => {
        let err: { code?: string; success?: boolean; error?: { code?: string; message?: string } } | undefined;
        try {
            await t.puter.apps.create({ indexURL: 'https://example.com/no-name' } as never);
        } catch (e) {
            err = e as typeof err;
        }
        // The backward-compatible data contract: top-level message/code plus
        // the legacy nested shape. (`instanceof Error` is covered in the
        // single-realm unit test — it isn't reliable across the prebuilt-bundle
        // boundary the browser fixture loads the SDK through.)
        t.assert.equal(typeof err?.message, 'string');
        t.assert.equal(err?.code, 'invalid_request');
        t.assert.equal(err?.success, false);
        t.assert.equal(err?.error?.code, 'invalid_request');
        t.assert.equal(err?.error?.message, 'Name is required');
    },

    'create rejects a missing index URL before any network call': async (t) => {
        let err: { error?: { message?: string } } | undefined;
        try {
            await (t.puter.apps.create as (n: string) => Promise<unknown>)('apps-suite-name-only');
        } catch (e) {
            err = e as typeof err;
        }
        t.assert.equal(err?.error?.message, 'Index URL is required');
    },

    'create accepts a positional title': async (t) => {
        const app = await t.puter.apps.create(
            'apps-suite-positional-title',
            'https://example.com/positional',
            'Positional Title',
        );
        t.assert.equal(app.title, 'Positional Title');
        const fetched = await t.puter.apps.get('apps-suite-positional-title');
        t.assert.equal(fetched.title, 'Positional Title');
    },

    'create defaults the title to the app name': async (t) => {
        const app = await t.puter.apps.create(
            'apps-suite-default-title',
            'https://example.com/default-title',
        );
        t.assert.equal(app.title, 'apps-suite-default-title');
    },

    'create with a non-object argument rejects with invalid_request': async (t) => {
        const err = await t.assert.rejects(
            () => (t.puter.apps.create as (n: unknown) => Promise<unknown>)(42),
            'a numeric argument should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'invalid_request');
        t.assert.equal(
            (err as { error?: { message?: string } })?.error?.message,
            'Name is required',
        );
    },

    'create with dedupeName picks a free name instead of conflicting': async (t) => {
        await t.puter.apps.create({
            name: 'apps-suite-dedupe',
            indexURL: 'https://example.com/dedupe',
        });
        const second = await t.puter.apps.create({
            name: 'apps-suite-dedupe',
            indexURL: 'https://example.com/dedupe-2',
            dedupeName: true,
        });
        t.assert.ok(
            second.name !== 'apps-suite-dedupe',
            `dedupeName should pick a new name, got ${second.name}`,
        );
    },

    'get accepts per-request params alongside the name': async (t) => {
        await t.puter.apps.create(
            'apps-suite-params',
            'https://example.com/params',
        );
        const app = await t.puter.apps.get('apps-suite-params', {
            icon_size: 64,
        } as never);
        t.assert.equal(app.name, 'apps-suite-params');
    },

    'list with a limit returns a plain array': async (t) => {
        await t.puter.apps.create(
            'apps-suite-limited',
            'https://example.com/limited',
        );
        const apps = (await t.puter.apps.list({ limit: 2 })) as Array<{
            name: string;
        }>;
        t.assert.equal(Array.isArray(apps), true, 'a limit alone keeps the array shape');
        t.assert.ok(apps.length <= 2, 'the limit should be respected');
    },

    'list with an offset returns a page envelope': async (t) => {
        for (const name of ['apps-suite-off-a', 'apps-suite-off-b']) {
            await t.puter.apps.create(name, `https://example.com/${name}`);
        }
        const page = (await t.puter.apps.list({ limit: 1, offset: 1 })) as {
            items?: Array<{ name: string }>;
        } | Array<{ name: string }>;
        const items = Array.isArray(page) ? page : (page.items ?? []);
        t.assert.equal(items.length, 1, 'offset paging returns one row');
    },

    'list forwards non-pagination options as request params': async (t) => {
        await t.puter.apps.create(
            'apps-suite-iconsize',
            'https://example.com/iconsize',
        );
        const apps = (await t.puter.apps.list({ icon_size: 64 } as never)) as Array<{
            name: string;
        }>;
        t.assert.equal(Array.isArray(apps), true);
        t.assert.ok(
            apps.some((a) => a.name === 'apps-suite-iconsize'),
            'the listing should still contain the created app',
        );
    },

    'list with stream rejects offset client-side': async (t) => {
        let err: { code?: string; message?: string } | undefined;
        try {
            t.puter.apps.list({ stream: true, offset: 1 } as never);
        } catch (e) {
            err = e as typeof err;
        }
        t.assert.equal(err?.code, 'invalid_request');
        t.assert.equal(
            err?.message,
            '`offset` cannot be combined with `stream`; pass `cursor` to resume from a position.',
        );
    },

    'returned apps carry the user-iteration helpers': async (t) => {
        const created = await t.puter.apps.create(
            'apps-suite-users',
            'https://example.com/users',
        );
        t.assert.equal(typeof created.getUsers, 'function');
        t.assert.equal(typeof created.users, 'function');
        const fetched = await t.puter.apps.get('apps-suite-users');
        t.assert.equal(typeof fetched.getUsers, 'function');
        const listed = await t.puter.apps.list();
        const match = listed.find((a) => a.name === 'apps-suite-users');
        t.assert.equal(typeof match?.getUsers, 'function');
    },

    'checkName without a name rejects with invalid_request': async (t) => {
        const err = await t.assert.rejects(
            () => (t.puter.apps.checkName as (n?: unknown) => Promise<unknown>)(''),
            'an empty name should be rejected',
        );
        t.assert.equal((err as { code?: string })?.code, 'invalid_request');
        t.assert.equal(
            (err as { error?: { message?: string } })?.error?.message,
            'Name is required',
        );
    },

    'checkName reports an available name as available': async (t) => {
        const result = await t.puter.apps.checkName(
            'apps-suite-definitely-free-name',
        );
        t.assert.ok(result && typeof result === 'object');
        t.assert.equal(
            JSON.stringify(result).includes('true'),
            true,
            `an unused name should read as available, got ${JSON.stringify(result)}`,
        );
    },

    'getDeveloperProfile fires trailing positional callbacks': async (t) => {
        const profile = await new Promise((resolve, reject) => {
            (
                t.puter.apps.getDeveloperProfile as (
                    s: (v: unknown) => void,
                    e: (r: unknown) => void,
                ) => void
            )(resolve, reject);
        });
        t.assert.ok(profile && typeof profile === 'object');
    },

    'update of an unknown app rejects': async (t) => {
        await t.assert.rejects(
            () =>
                t.puter.apps.update('apps-suite-never-created', {
                    indexURL: 'https://example.com/nope',
                }),
            'updating a nonexistent app should reject',
        );
    },

    'delete of an unknown app rejects': async (t) => {
        await t.assert.rejects(
            () => t.puter.apps.delete('apps-suite-never-existed'),
            'deleting a nonexistent app should reject',
        );
    },

    'create remaps camelCase options to the stored app fields': async (t) => {
        await t.puter.apps.create({
            name: 'apps-suite-remap',
            indexURL: 'https://example.com/remap',
            filetypeAssociations: ['.txt', 'image/png'],
            maximizeOnStart: true,
        });
        const fetched = await t.puter.apps.get('apps-suite-remap');
        // Extensions are canonicalized to the bare lowercase form on write
        // ('.txt' → 'txt'); MIME-type associations pass through unchanged.
        t.assert.deepEqual(fetched.filetype_associations, ['txt', 'image/png']);
        t.assert.equal(Boolean(fetched.maximize_on_start), true);
    },
});
