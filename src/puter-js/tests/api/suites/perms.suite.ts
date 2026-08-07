import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/** Read a file as the `other` user via plain fetch — works on every platform. */
const readAsOther = (t: TestContext, path: string) =>
    fetch(
        `${t.env.apiOrigin}/read?${new URLSearchParams({ file: path })}`,
        {
            headers: {
                Authorization: `Bearer ${t.env.users.other.token}`,
                Origin: t.env.apiOrigin,
            },
        },
    );

export default suite('perms', {
    'grantUser lets another user read a file': async (t) => {
        const path = `${home(t)}/perms-suite-shared.txt`;
        await t.puter.fs.write(path, 'shared content');

        const before = await readAsOther(t, path);
        t.assert.ok(
            before.status !== 200,
            `other user should not read before grant (got ${before.status})`,
        );

        const granted = await t.puter.perms.grantUser(
            t.env.users.other.username,
            `fs:${path}:read`,
        );
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);

        const after = await readAsOther(t, path);
        t.assert.equal(after.status, 200);
        t.assert.equal(await after.text(), 'shared content');
    },

    'revokeUser takes a granted permission away': async (t) => {
        const path = `${home(t)}/perms-suite-revoked.txt`;
        await t.puter.fs.write(path, 'soon private again');
        const permission = `fs:${path}:read`;

        await t.puter.perms.grantUser(t.env.users.other.username, permission);
        const whileGranted = await readAsOther(t, path);
        t.assert.equal(whileGranted.status, 200);

        const revoked = await t.puter.perms.revokeUser(
            t.env.users.other.username,
            permission,
        );
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);

        const afterRevoke = await readAsOther(t, path);
        t.assert.ok(
            afterRevoke.status !== 200,
            `read should fail after revoke (got ${afterRevoke.status})`,
        );
    },

    'grantUser to an unknown user reports an error': async (t) => {
        const res = await t.puter.perms.grantUser(
            'perms-suite-no-such-user',
            `fs:${home(t)}/whatever.txt:read`,
        );
        t.assert.ok(res.error, 'granting to an unknown user should error');
    },

    'createGroup returns a group uid': async (t) => {
        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-group',
        });
        t.assert.ok(!created.error, `create failed: ${JSON.stringify(created)}`);
        t.assert.ok(created.uid, 'created group should have a uid');
    },

    'listGroups includes a created group': async (t) => {
        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-listed-group',
        });
        const groups = await t.puter.perms.listGroups();
        t.assert.ok(!groups.error, `list failed: ${JSON.stringify(groups)}`);
        const all = JSON.stringify(groups);
        t.assert.ok(
            all.includes(created.uid),
            'listGroups should mention the created group uid',
        );
    },

    'addUsersToGroup and removeUsersFromGroup succeed': async (t) => {
        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-membership',
        });
        const added = await t.puter.perms.addUsersToGroup(created.uid, [
            t.env.users.other.username,
        ]);
        t.assert.ok(!added.error, `add failed: ${JSON.stringify(added)}`);
        const removed = await t.puter.perms.removeUsersFromGroup(created.uid, [
            t.env.users.other.username,
        ]);
        t.assert.ok(!removed.error, `remove failed: ${JSON.stringify(removed)}`);
    },

    'grantGroup lets group members read a file': async (t) => {
        const path = `${home(t)}/perms-suite-group-shared.txt`;
        await t.puter.fs.write(path, 'group content');

        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-readers',
        });
        await t.puter.perms.addUsersToGroup(created.uid, [
            t.env.users.other.username,
        ]);
        const granted = await t.puter.perms.grantGroup(
            created.uid,
            `fs:${path}:read`,
        );
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);

        const res = await readAsOther(t, path);
        t.assert.equal(res.status, 200);
        t.assert.equal(await res.text(), 'group content');
    },

    'grantGroup then revokeGroup both succeed': async (t) => {
        const path = `${home(t)}/perms-suite-group-revoke.txt`;
        await t.puter.fs.write(path, 'group revoke content');
        const permission = `fs:${path}:read`;

        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-revoke-readers',
        });
        await t.puter.perms.addUsersToGroup(created.uid, [
            t.env.users.other.username,
        ]);
        const granted = await t.puter.perms.grantGroup(created.uid, permission);
        t.assert.ok(!granted.error, `grant failed: ${JSON.stringify(granted)}`);

        const revoked = await t.puter.perms.revokeGroup(created.uid, permission);
        t.assert.ok(!revoked.error, `revoke failed: ${JSON.stringify(revoked)}`);
    },

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

    'granting a permission on a path that does not exist is refused': async (t) => {
        const result = await t.puter.perms.grantUser(
            t.env.users.other.username,
            `fs:${home(t)}/perms-suite-never-created.txt:read`,
        );
        t.assert.ok(result.error, 'granting on a missing entry should error');
        t.assert.equal(result.code, 'subject_does_not_exist');
    },

    // -- Groups --

    'createGroup defaults its metadata when called with no arguments': async (t) => {
        const created = await t.puter.perms.createGroup();
        t.assert.ok(!created.error, `create failed: ${JSON.stringify(created)}`);
        t.assert.equal(typeof created.uid, 'string');

        const groups = (await t.puter.perms.listGroups()) as {
            owned_groups?: Array<{ uid: string; metadata: unknown; extra: unknown }>;
        };
        const mine = groups.owned_groups?.find((g) => g.uid === created.uid);
        t.assert.ok(mine, 'the new group should be listed as owned');
        t.assert.deepEqual(mine!.metadata, {});
        t.assert.deepEqual(mine!.extra, {});
    },

    'addUsersToGroup with no usernames is accepted as an empty list': async (t) => {
        const created = await t.puter.perms.createGroup({
            title: 'perms-suite-empty-membership',
        });
        const added = await (
            t.puter.perms.addUsersToGroup as (uid: string) => Promise<{
                error?: unknown;
            }>
        )(created.uid);
        t.assert.ok(!added.error, `add failed: ${JSON.stringify(added)}`);
        const removed = await (
            t.puter.perms.removeUsersFromGroup as (uid: string) => Promise<{
                error?: unknown;
            }>
        )(created.uid);
        t.assert.ok(!removed.error, `remove failed: ${JSON.stringify(removed)}`);
    },

    // -- Low-level request helper --

    'req_ reports an unknown route as an error result rather than throwing': async (
        t,
    ) => {
        const result = await (
            t.puter.perms as unknown as {
                req_: (route: string) => Promise<Record<string, unknown>>;
            }
        ).req_('/perms-suite/no-such-route');
        t.assert.equal(result.error, true);
        t.assert.equal(result.code, 'not_found');
    },

    // -- Special folders --

    'requesting read access to an already-readable folder returns its path': async (
        t,
    ) => {
        for (const [folder, request] of [
            ['Desktop', () => t.puter.perms.requestReadDesktop()],
            ['Documents', () => t.puter.perms.requestReadDocuments()],
            ['Pictures', () => t.puter.perms.requestReadPictures()],
            ['Videos', () => t.puter.perms.requestReadVideos()],
        ] as const) {
            const expected = `${home(t)}/${folder}`;
            // Guard first: without read access the helper would fall through
            // to an interactive permission prompt.
            t.assert.ok(
                await t.puter.fs.stat({ path: expected }),
                `${folder} should already exist for the seeded user`,
            );
            t.assert.equal(await request(), expected);
        }
    },

    // Write access always prompts, even for a folder that is already readable.
    // Restricted to the runtimes where the prompt resolves without a UI: on
    // `web` it opens a popup window a headless suite cannot answer.
    'requesting write access to a folder is denied without a grant': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            t.assert.equal(await t.puter.perms.requestWriteDesktop(), undefined);
            t.assert.equal(await t.puter.perms.requestWriteDocuments(), undefined);
            t.assert.equal(await t.puter.perms.requestWritePictures(), undefined);
            t.assert.equal(await t.puter.perms.requestWriteVideos(), undefined);
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
            t.assert.equal(await t.puter.perms.requestReadApps(), false);
            t.assert.equal(await t.puter.perms.requestManageApps(), false);
            t.assert.equal(await t.puter.perms.requestReadSubdomains(), false);
            t.assert.equal(await t.puter.perms.requestManageSubdomains(), false);
            t.assert.equal(
                await t.puter.perms.request(`fs:${home(t)}:write`),
                false,
            );
            // The deprecated alias must keep delegating to `request`.
            t.assert.equal(
                await t.puter.perms.requestPermission(`fs:${home(t)}:write`),
                false,
            );
        },
    },

    // -- App root directory --

    'requestReadAppRootDir rejects an app uid that is not a string': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestReadAppRootDir as (
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

    'requestWriteAppRootDir rejects an object without a uid': async (t) => {
        const error = (await t.assert.rejects(() =>
            (
                t.puter.perms.requestWriteAppRootDir as (
                    appUid: unknown,
                ) => Promise<unknown>
            )({}),
        )) as Error & { code?: string };
        t.assert.equal(error.code, 'invalid_argument');
    },

    // Only the app itself may claim its root dir, so a user-token caller is
    // refused and then offered the permission prompt. Restricted to the
    // runtimes where that prompt resolves without a window.
    'requestReadAppRootDir resolves undefined when the grant is refused': {
        platforms: ['node', 'workerd'],
        fn: async (t) => {
            const app = await t.puter.apps.create(
                t.puter.randName(),
                'https://example.com/perms-root-dir',
            );
            t.assert.equal(
                await t.puter.perms.requestReadAppRootDir(app.uid),
                undefined,
            );
            t.assert.equal(
                await t.puter.perms.requestWriteAppRootDir({ uid: app.uid }),
                undefined,
            );
        },
    },
});
