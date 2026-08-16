import { suite } from '../harness/types.ts';

export default suite('os', {
    'user returns the authenticated user': async (t) => {
        const user = await t.puter.os.user();
        t.assert.ok(user && typeof user === 'object', 'user should be an object');
        t.assert.equal(user.username, t.env.users.user.username);
        t.assert.equal(
            typeof user.created_ts,
            'number',
            'created_ts should be unix seconds',
        );
    },

    'user accepts trailing success/error callbacks': async (t) => {
        const user = await new Promise((resolve, reject) => {
            (t.puter.os.user as (s: (v: unknown) => void, e: (r: unknown) => void) => void)(
                resolve,
                reject,
            );
        });
        t.assert.equal(
            (user as { username: string }).username,
            t.env.users.user.username,
        );
    },

    'user forwards a query object to the whoami request': async (t) => {
        const user = await t.puter.os.user({
            query: { icon_size: '64' },
        } as never);
        t.assert.equal(user.username, t.env.users.user.username);
    },

    'user fires the success callback from the options object': async (t) => {
        let seen: { username?: string } | undefined;
        const user = await t.puter.os.user({
            success: (value: { username?: string }) => { seen = value; },
        } as never);
        t.assert.equal(seen?.username, t.env.users.user.username);
        t.assert.equal(user.username, seen?.username);
    },

    'concurrent user reads are coalesced onto one result': async (t) => {
        const [first, second] = await Promise.all([
            t.puter.os.user(),
            t.puter.os.user(),
        ]);
        t.assert.equal(first.username, t.env.users.user.username);
        t.assert.deepEqual(first, second);
    },

    'version returns deployment version info': async (t) => {
        const version = await t.puter.os.version();
        t.assert.ok(
            version && typeof version === 'object',
            'version should be an object',
        );
    },

    'version fires trailing success/error callbacks': async (t) => {
        const version = await new Promise((resolve, reject) => {
            (
                t.puter.os.version as (
                    s: (v: unknown) => void,
                    e: (r: unknown) => void,
                ) => void
            )(resolve, reject);
        });
        t.assert.ok(version && typeof version === 'object');
    },

    'version fires the success callback from the options object': async (t) => {
        let seen: unknown;
        const version = await t.puter.os.version({
            success: (value: unknown) => { seen = value; },
        } as never);
        t.assert.deepEqual(seen, version);
    },
});
