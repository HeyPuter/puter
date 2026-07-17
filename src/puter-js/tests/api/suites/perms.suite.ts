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
});
