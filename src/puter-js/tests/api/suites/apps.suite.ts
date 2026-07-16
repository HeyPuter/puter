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
