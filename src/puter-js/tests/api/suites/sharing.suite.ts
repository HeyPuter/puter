import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

const home = (t: TestContext) => `/${t.env.users.user.username}`;

/** A unique path under the acting user's home. */
const scratch = (t: TestContext, label: string) =>
    `${home(t)}/sharing-${label}-${Math.random().toString(36).slice(2, 8)}.txt`;

/** Read a file as the `other` user — plain fetch, so it works everywhere. */
const readAsOther = (t: TestContext, path: string) =>
    fetch(`${t.env.apiOrigin}/read?${new URLSearchParams({ file: path })}`, {
        headers: {
            Authorization: `Bearer ${t.env.users.other.token}`,
            Origin: t.env.apiOrigin,
        },
    });

export default suite('sharing', {
    'share gives another user access, unshare takes it back': async (t) => {
        const path = scratch(t, 'roundtrip');
        await t.puter.fs.write(path, 'shared content');

        const before = await readAsOther(t, path);
        t.assert.ok(
            before.status !== 200,
            `should not read before sharing (got ${before.status})`,
        );

        const shares = await t.puter.fs.share(
            path,
            t.env.users.other.username,
            'read',
        );
        t.assert.equal(shares.length, 1);
        t.assert.equal(shares[0].mode, 'read');
        t.assert.equal(shares[0].holder, t.env.users.other.username);

        const after = await readAsOther(t, path);
        t.assert.equal(after.status, 200);
        t.assert.equal(await after.text(), 'shared content');

        const revoked = await t.puter.fs.unshare(
            path,
            t.env.users.other.username,
        );
        t.assert.equal(revoked.revoked, 1);

        const afterRevoke = await readAsOther(t, path);
        t.assert.ok(
            afterRevoke.status !== 200,
            `read should fail after unshare (got ${afterRevoke.status})`,
        );
    },

    'share accepts an options object and defaults to read': async (t) => {
        const path = scratch(t, 'options');
        await t.puter.fs.write(path, 'x');

        const shares = await t.puter.fs.share({
            path,
            recipient: { username: t.env.users.other.username },
        });
        t.assert.equal(shares[0].mode, 'read');
        t.assert.equal(shares[0].path, path);
    },

    'getShares reports who can reach an item': async (t) => {
        const path = scratch(t, 'getshares');
        await t.puter.fs.write(path, 'x');
        await t.puter.fs.share(path, t.env.users.other.username, 'write');

        const shares = await t.puter.fs.getShares(path);
        t.assert.equal(shares.length, 1);
        t.assert.equal(shares[0].holder, t.env.users.other.username);
        t.assert.equal(shares[0].mode, 'write');
        t.assert.equal(shares[0].issuer, t.env.users.user.username);
    },

    'changing the mode replaces the share rather than adding one': async (t) => {
        const path = scratch(t, 'remode');
        await t.puter.fs.write(path, 'x');

        await t.puter.fs.share(path, t.env.users.other.username, 'read');
        await t.puter.fs.share(path, t.env.users.other.username, 'write');

        const shares = await t.puter.fs.getShares(path);
        t.assert.equal(shares.length, 1);
        t.assert.equal(shares[0].mode, 'write');
    },

    'listShared returns a page envelope with a total': async (t) => {
        const path = scratch(t, 'listed');
        await t.puter.fs.write(path, 'x');
        await t.puter.fs.share(path, t.env.users.other.username, 'read');

        const page = await t.puter.fs.listShared({ includeTotal: true });
        t.assert.ok(Array.isArray(page.items), 'items should be an array');
        t.assert.equal(typeof page.total, 'number');
        // The sharer is not the holder, so their own item is not listed here.
        t.assert.ok(
            !page.items.some((share) => share.path === path),
            'sharer should not see their own item in shared-with-me',
        );
    },

    'sharing an unknown recipient rejects': async (t) => {
        const path = scratch(t, 'nobody');
        await t.puter.fs.write(path, 'x');

        let failed = false;
        try {
            await t.puter.fs.share(path, 'no-such-user-zzz', 'read');
        } catch (e) {
            failed = true;
            t.assert.ok(
                typeof (e as { code?: string }).code === 'string',
                'error should carry a code',
            );
        }
        t.assert.ok(failed, 'sharing with an unknown user should reject');
    },

    'unsharing something never shared reports nothing revoked': async (t) => {
        const path = scratch(t, 'noop');
        await t.puter.fs.write(path, 'x');

        const result = await t.puter.fs.unshare(
            path,
            t.env.users.other.username,
        );
        t.assert.equal(result.revoked, 0);
    },
});
