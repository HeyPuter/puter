import { suite } from '../harness/types.ts';

export default suite('kv', {
    'set then get round-trips a string': async (t) => {
        t.assert.equal(await t.puter.kv.set('kv-suite-str', 'value'), true);
        t.assert.equal(await t.puter.kv.get('kv-suite-str'), 'value');
    },

    'set then get round-trips an object': async (t) => {
        await t.puter.kv.set('kv-suite-obj', { nested: { n: 1 } });
        t.assert.deepEqual(await t.puter.kv.get('kv-suite-obj'), {
            nested: { n: 1 },
        });
    },

    'get of a missing key returns null': async (t) => {
        t.assert.equal(await t.puter.kv.get('kv-suite-missing'), null);
    },

    'del removes a key': async (t) => {
        await t.puter.kv.set('kv-suite-del', 'x');
        t.assert.equal(await t.puter.kv.del('kv-suite-del'), true);
        t.assert.equal(await t.puter.kv.get('kv-suite-del'), null);
    },

    'incr counts up': async (t) => {
        t.assert.equal(await t.puter.kv.incr('kv-suite-counter'), 1);
        t.assert.equal(await t.puter.kv.incr('kv-suite-counter'), 2);
    },
});
