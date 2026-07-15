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
});
