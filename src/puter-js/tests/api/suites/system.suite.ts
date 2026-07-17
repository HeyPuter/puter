import { suite } from '../harness/types.ts';

export default suite('system', {
    'os.version reports a version': async (t) => {
        const version = await t.puter.os.version();
        t.assert.ok(
            version && typeof version === 'object',
            'version should be an object',
        );
    },

    'os.user returns the authenticated user': async (t) => {
        const user = await t.puter.os.user();
        t.assert.equal(user.username, t.env.users.user.username);
    },

    'drivers.list includes the core interfaces': async (t) => {
        const interfaces = await t.puter.drivers.list();
        for (const expected of [
            'puter-kvstore',
            'puter-apps',
            'puter-subdomains',
            'puter-chat-completion',
        ]) {
            t.assert.ok(
                Object.prototype.hasOwnProperty.call(interfaces, expected),
                `interfaces should include ${expected}`,
            );
        }
    },

    'drivers.call reaches a driver method generically': async (t) => {
        const result = await t.puter.drivers.call(
            'puter-kvstore',
            'set',
            { key: 'system-suite-driver-call', value: 'via drivers.call' },
        );
        t.assert.ok(result.success, 'driver call should succeed');
        t.assert.equal(
            await t.puter.kv.get('system-suite-driver-call'),
            'via drivers.call',
        );
    },

    'drivers.call on an unknown interface reports failure': async (t) => {
        const result = await t.puter.drivers.call(
            'system-suite-no-such-interface',
            'nope',
            {},
        );
        t.assert.ok(
            !result?.success,
            `unknown interface should not succeed: ${JSON.stringify(result)}`,
        );
    },

    'drivers.call on an unknown method reports failure': async (t) => {
        const result = await t.puter.drivers.call(
            'puter-kvstore',
            'system-suite-no-such-method',
            {},
        );
        t.assert.ok(
            !result?.success,
            `unknown method should not succeed: ${JSON.stringify(result)}`,
        );
    },
});
