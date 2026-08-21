import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/** A permission string nothing grants, so asking for it is always a denial. */
const UNHELD_PERMISSION = 'nonexistent-namespace:nothing:read';

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
                await t.puter.perms.request('permission', {
                    permission: UNHELD_PERMISSION,
                }),
                false,
            );
            // A lone string is still the permission string it always was.
            t.assert.equal(
                await t.puter.perms.request(UNHELD_PERMISSION),
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

    'each special folder resolves to its path when already readable': async (t) => {
        for (const folder of [
            'Desktop',
            'Documents',
            'Pictures',
            'Videos',
        ] as const) {
            const expected = `${home(t)}/${folder}`;
            // Guard first: without read access this would fall through to an
            // interactive permission prompt.
            t.assert.ok(
                await t.puter.fs.stat({ path: expected }),
                `${folder} should already exist for the seeded user`,
            );
            t.assert.equal(
                await t.puter.perms.request('folder', { name: folder }),
                expected,
            );
            t.assert.equal(
                await t.puter.perms.check('folder', { name: folder }),
                true,
            );
        }
    },

    // A user's own credential already covers their own folders, so `request`
    // settles from `check` and never prompts. The prompt is for an app asking
    // on their behalf, which holds none of this to begin with.
    'write access a user already holds resolves without a prompt': async (t) => {
        for (const folder of [
            'Desktop',
            'Documents',
            'Pictures',
            'Videos',
        ] as const) {
            const details = { name: folder, access: 'write' } as const;
            t.assert.equal(await t.puter.perms.check('folder', details), true);
            t.assert.equal(
                await t.puter.perms.request('folder', details),
                `${home(t)}/${folder}`,
            );
        }
    },

    // -- Permission requests --

    'requestEmail returns the stored email without prompting': async (t) => {
        const whoami = await t.puter.auth.whoami();
        t.assert.equal(await t.puter.perms.requestEmail(), whoami.email);
    },

    // Their own apps and subdomains namespaces are theirs implicitly, at both
    // access levels, so these settle from `check` too.
    'a user already holds their own apps and subdomains namespaces': async (t) => {
        for (const resource of ['apps', 'subdomains'] as const) {
            for (const access of ['read', 'write'] as const) {
                t.assert.equal(
                    await t.puter.perms.check(resource, { access }),
                    true,
                );
                t.assert.equal(
                    await t.puter.perms.request(resource, { access }),
                    true,
                );
            }
        }
    },

    // The one-method-per-task names still ship for apps written against them,
    // and still prompt without consulting what is already held — which is why
    // the folder and apps assertions here are the opposite of what `request`
    // now answers for the same access. `requestPermission` is the exception:
    // it forwards to `request`, so it picks up the new behaviour (asserted
    // separately below).
    'the deprecated request aliases keep delegating': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const perms = t.puter.perms as unknown as Record<
                string,
                (...args: unknown[]) => Promise<unknown>
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
            const app = await t.puter.apps.create(
                t.puter.randName(),
                'https://example.com/perms-alias-root-dir',
            );
            t.assert.equal(
                await perms.requestReadAppRootDir(app.uid),
                undefined,
            );
            t.assert.equal(
                await perms.requestWriteAppRootDir(app.uid),
                undefined,
            );
        },
    },

    // `requestPermission` forwards to `request`, so it settles from what is
    // held rather than prompting for it. That is a change from prompting every
    // time: a permission the caller already holds now answers `true` where the
    // prompt used to decide it.
    'requestPermission settles a held permission without prompting': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const perms = t.puter.perms as unknown as {
                requestPermission: (p: string) => Promise<boolean>;
            };
            // A user's own credential covers their own home directory.
            t.assert.equal(
                await perms.requestPermission(`fs:${home(t)}:write`),
                true,
            );
            t.assert.equal(
                await perms.requestPermission(UNHELD_PERMISSION),
                false,
            );
        },
    },

    // -- App root directory --

    'appRootDir rejects an app that is not a uid or an object with one': async (
        t,
    ) => {
        const error = (await t.assert.rejects(() =>
            t.puter.perms.request('appRootDir', {
                app: 42 as unknown as string,
            }),
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

        const noUid = (await t.assert.rejects(() =>
            t.puter.perms.request('appRootDir', {
                app: {} as unknown as { uid: string },
            }),
        )) as Error & { code?: string };
        t.assert.equal(noUid.code, 'invalid_argument');
    },

    // Only the app itself may claim its root dir, so a user-token caller is
    // refused. `check` reports that without provisioning anything, and without
    // the prompt a `request` would go on to raise.
    'checking another app\'s root dir reports false and creates nothing': async (
        t,
    ) => {
        const app = await t.puter.apps.create(
            t.puter.randName(),
            'https://example.com/perms-root-dir-check',
        );
        t.assert.equal(
            await t.puter.perms.check('appRootDir', { app: app.uid }),
            false,
        );
        await t.assert.rejects(() =>
            t.puter.fs.stat({ path: `${home(t)}/AppData/${app.uid}` }),
        );
    },

    // Refused, then offered the permission prompt. Restricted to the runtimes
    // where that prompt resolves without a window.
    'appRootDir resolves undefined when the grant is refused': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const app = await t.puter.apps.create(
                t.puter.randName(),
                'https://example.com/perms-root-dir',
            );
            t.assert.equal(
                await t.puter.perms.request('appRootDir', { app: app.uid }),
                undefined,
            );
            t.assert.equal(
                await t.puter.perms.request('appRootDir', {
                    app: { uid: app.uid },
                    access: 'write',
                }),
                undefined,
            );
        },
    },
});
