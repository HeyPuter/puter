import { suite } from '../harness/types.ts';

export default suite('os', {
    'user returns the authenticated user': async (t) => {
        const user = await t.puter.os.user();
        t.assert.ok(user && typeof user === 'object', 'user should be an object');
        t.assert.equal(user.username, t.env.users.user.username);
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

    'version returns deployment version info': async (t) => {
        const version = await t.puter.os.version();
        t.assert.ok(
            version && typeof version === 'object',
            'version should be an object',
        );
    },
});
