import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

export default suite('perms', {
    // -- Grant / revoke against an app --

    'grantApp records an app permission': async (t) => {
        const app = await t.puter.apps.create(
            'perms-suite-app',
            'https://example.com/perms',
        );
        const path = `${home(t)}/perms-suite-app-file.txt`;
        await t.puter.fs.write(path, 'app-readable');
        const granted = await t.puter.perms.grantApp(
            app.uid,
            `fs:${path}:read`,
        );
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);
        const revoked = await t.puter.perms.revokeApp(
            app.uid,
            `fs:${path}:read`,
        );
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);
    },

    // Uninstalling an app clears every grant it holds in one call.
    'revokeApp with "*" clears every grant for the app': async (t) => {
        const app = await t.puter.apps.create(
            t.puter.randName(),
            'https://example.com/perms-revoke-all',
        );
        const path = `${home(t)}/perms-suite-revoke-all.txt`;
        await t.puter.fs.write(path, 'x');
        await t.puter.perms.grantApp(app.uid, `fs:${path}:read`);

        const revoked = await t.puter.perms.revokeApp(app.uid, '*');
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);
    },

    // A third-party site is identified by origin rather than app uid, which
    // the backend resolves back to the app registered at that origin.
    'grantOrigin and revokeOrigin address the app registered at that origin': async (
        t,
    ) => {
        const path = `${home(t)}/perms-suite-origin-file.txt`;
        await t.puter.fs.write(path, 'origin-readable');
        const permission = `fs:${path}:read`;
        const name = t.puter.randName();
        const origin = `https://${name}.example.com`;
        await t.puter.apps.create(name, `${origin}/index.html`);

        const granted = await t.puter.perms.grantOrigin(origin, permission);
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);
        const revoked = await t.puter.perms.revokeOrigin(origin, permission);
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);
    },

    'granting to an origin with no registered app is refused': async (t) => {
        const path = `${home(t)}/perms-suite-unknown-origin.txt`;
        await t.puter.fs.write(path, 'x');
        const result = await t.puter.perms.grantOrigin(
            'https://perms-suite-unregistered.example.com',
            `fs:${path}:read`,
        );
        t.assert.equal(result.error, true);
        t.assert.equal(result.code, 'subject_does_not_exist');
    },

    'grantAppAnyUser and revokeAppAnyUser round-trip': async (t) => {
        const app = await t.puter.apps.create(
            t.puter.randName(),
            'https://example.com/perms-any-user',
        );
        const path = `${home(t)}/perms-suite-any-user-file.txt`;
        await t.puter.fs.write(path, 'any-user-readable');
        const permission = `fs:${path}:read`;

        const granted = await t.puter.perms.grantAppAnyUser(app.uid, permission);
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);
        const revoked = await t.puter.perms.revokeAppAnyUser(app.uid, permission);
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);
    },

    // -- request(resource, details) --

    'request resolves a folder to its path and email to the address': async (
        t,
    ) => {
        const whoami = await t.puter.auth.whoami();
        t.assert.equal(
            await t.puter.perms.request('folder', { name: 'Desktop' }),
            `${home(t)}/Desktop`,
        );
        t.assert.equal(await t.puter.perms.request('email'), whoami.email);
    },

    'request rejects a folder it does not cover and an unknown access level': async (
        t,
    ) => {
        const folder = (await t.assert.rejects(() =>
            t.puter.perms.request('folder', {
                name: 'Trash' as unknown as 'Desktop',
            }),
        )) as Error & { code?: string };
        t.assert.equal(folder.code, 'invalid_argument');

        const access = (await t.assert.rejects(() =>
            t.puter.perms.request('apps', {
                access: 'delete' as unknown as 'read',
            }),
        )) as Error & { code?: string };
        t.assert.equal(access.code, 'invalid_argument');
    },

    // Details beside a non-resource name is a typo, not the legacy form.
    'request rejects details passed with an unknown resource': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.request as (
                    resource: string,
                    details: unknown,
                ) => Promise<unknown>
            )('folders', { name: 'Desktop' }),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    'request denies what is not granted, in both the resource and raw forms': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            t.assert.equal(
                await t.puter.perms.request('folder', {
                    name: 'Videos',
                    access: 'write',
                }),
                undefined,
            );
            t.assert.equal(
                await t.puter.perms.request('permission', {
                    permission: `fs:${home(t)}:write`,
                }),
                false,
            );
            // A lone string is still the permission string it always was.
            t.assert.equal(
                await t.puter.perms.request(`fs:${home(t)}:write`),
                false,
            );
        },
    },

    // -- check(resource, details) --

    'check answers without prompting': async (t) => {
        t.assert.equal(
            await t.puter.perms.check('folder', { name: 'Desktop' }),
            true,
        );
        t.assert.equal(await t.puter.perms.check('email'), true);
        t.assert.equal(
            typeof (await t.puter.perms.check('apps', { access: 'write' })),
            'boolean',
        );
    },

    // All-or-nothing: a set is held only when every permission in it is.
    'check reports false when part of a set is missing': async (t) => {
        t.assert.equal(
            await t.puter.perms.check('permission', {
                permissions: [
                    `fs:${home(t)}/Desktop:read`,
                    'nonexistent-namespace:nothing:read',
                ],
            }),
            false,
        );
    },

    'check validates its details the same way request does': async (t) => {
        const error = (await t.assert.rejects(() =>
            t.puter.perms.check('folder', {
                name: 'Trash' as unknown as 'Desktop',
            }),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // -- Batching --

    // Both folders are already readable, so no prompt: runs on every platform.
    'a batch resolves each entry in order': async (t) => {
        const results = await t.puter.perms.request([
            { resource: 'folder', name: 'Desktop' },
            { resource: 'folder', name: 'Documents' },
        ]);
        t.assert.deepEqual(results, [
            `${home(t)}/Desktop`,
            `${home(t)}/Documents`,
        ]);

        t.assert.deepEqual(
            await t.puter.perms.check([
                { resource: 'folder', name: 'Desktop' },
                { resource: 'folder', name: 'Documents' },
            ]),
            [true, true],
        );
    },

    'an empty batch resolves to an empty list': async (t) => {
        t.assert.deepEqual(await t.puter.perms.request([]), []);
        t.assert.deepEqual(await t.puter.perms.check([]), []);
    },

    'a batch rejects an entry naming no resource': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.request as (requests: unknown[]) => Promise<unknown>
            )([{ name: 'Desktop' }]),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // -- Special folders --

    'requestFolder returns the path of an already-readable folder': async (t) => {
        for (const folder of [
            'Desktop',
            'Documents',
            'Pictures',
            'Videos',
        ] as const) {
            const expected = `${home(t)}/${folder}`;
            // Guard first: without read access the helper would fall through
            // to an interactive permission prompt.
            t.assert.ok(
                await t.puter.fs.stat({ path: expected }),
                `${folder} should already exist for the seeded user`,
            );
            t.assert.equal(await t.puter.perms.requestFolder(folder), expected);
        }
    },

    'requestFolder rejects a folder it does not cover': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestFolder as (
                    folder: unknown,
                ) => Promise<unknown>
            )('Trash'),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    'requestFolder rejects an unknown access level': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestFolder as (
                    folder: string,
                    access: unknown,
                ) => Promise<unknown>
            )('Desktop', 'delete'),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // Write access always prompts, even for a folder that is already readable.
    // Restricted to the runtimes where the prompt resolves without a UI: on
    // `web` it opens a popup window a headless suite cannot answer.
    'requesting write access to a folder is denied without a grant': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            for (const folder of [
                'Desktop',
                'Documents',
                'Pictures',
                'Videos',
            ] as const) {
                t.assert.equal(
                    await t.puter.perms.requestFolder(folder, 'write'),
                    undefined,
                );
            }
        },
    },

    // -- Permission requests --

    'requestEmail returns the stored email without prompting': async (t) => {
        const whoami = await t.puter.auth.whoami();
        t.assert.equal(await t.puter.perms.requestEmail(), whoami.email);
    },

    // Same reasoning as the folder write test: these go through the
    // environment's permission prompt, which only resolves synchronously
    // where there is no window to open.
    'app and subdomain access requests are denied without a grant': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            t.assert.equal(await t.puter.perms.requestApps(), false);
            t.assert.equal(await t.puter.perms.requestApps('write'), false);
            t.assert.equal(await t.puter.perms.requestSubdomains(), false);
            t.assert.equal(
                await t.puter.perms.requestSubdomains('write'),
                false,
            );
            t.assert.equal(
                await t.puter.perms.request(`fs:${home(t)}:write`),
                false,
            );
        },
    },

    'requestApps rejects an unknown access level': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestApps as (
                    access: unknown,
                ) => Promise<unknown>
            )('manage'),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // The one-method-per-task names still ship for apps written against them.
    'the deprecated request aliases keep delegating': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const perms = t.puter.perms as unknown as Record<
                string,
                () => Promise<unknown>
            >;
            t.assert.equal(await perms.requestReadApps(), false);
            t.assert.equal(await perms.requestManageApps(), false);
            t.assert.equal(await perms.requestReadSubdomains(), false);
            t.assert.equal(await perms.requestManageSubdomains(), false);
            t.assert.equal(await perms.requestWriteDesktop(), undefined);
            t.assert.equal(await perms.requestWriteDocuments(), undefined);
            t.assert.equal(await perms.requestWritePictures(), undefined);
            t.assert.equal(await perms.requestWriteVideos(), undefined);
            t.assert.equal(
                await perms.requestReadDesktop(),
                `${home(t)}/Desktop`,
            );
            t.assert.equal(
                await (
                    t.puter.perms as unknown as {
                        requestPermission: (p: string) => Promise<boolean>;
                    }
                ).requestPermission(`fs:${home(t)}:write`),
                false,
            );
        },
    },

    // -- App root directory --

    'requestAppRootDir rejects an app uid that is not a string': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestAppRootDir as (
                    appUid: unknown,
                ) => Promise<unknown>
            )(42),
        )) as Error & { code?: string };
        t.assert.ok(error instanceof Error, 'should be a real Error');
        t.assert.equal(error.code, 'invalid_argument');
        t.assert.equal(error.message, 'parameter app_uid must be a string');
        // `message` and `code` are own enumerable properties, so the legacy
        // plain-object shape callers destructure keeps working.
        t.assert.deepEqual(
            JSON.parse(JSON.stringify(error)),
            {
                message: 'parameter app_uid must be a string',
                code: 'invalid_argument',
            },
        );
    },

    'requestAppRootDir rejects an object without a uid': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestAppRootDir as (
                    appUid: unknown,
                ) => Promise<unknown>
            )({}),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // Only the app itself may claim its root dir, so a user-token caller is
    // refused and then offered the permission prompt. Restricted to the
    // runtimes where that prompt resolves without a window.
    'requestAppRootDir resolves undefined when the grant is refused': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const app = await t.puter.apps.create(
                t.puter.randName(),
                'https://example.com/perms-root-dir',
            );
            t.assert.equal(
                await t.puter.perms.requestAppRootDir(app.uid),
                undefined,
            );
            t.assert.equal(
                await t.puter.perms.requestAppRootDir(
                    { uid: app.uid },
                    'write',
                ),
                undefined,
            );
        },
    },
});
