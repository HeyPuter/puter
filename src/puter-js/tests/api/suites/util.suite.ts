import { suite } from '../harness/types.ts';

/**
 * puter.js utility helpers (`puter.randName`, `puter.env`). These are pure
 * client-side helpers, so they run identically on every platform.
 * DOM-bound utilities like `puter.print` are covered by the browser
 * fixtures, not here.
 */
export default suite('util', {
    'randName returns a domain-safe name': async (t) => {
        const name = t.puter.randName();
        t.assert.equal(typeof name, 'string');
        t.assert.ok(name.length > 0, 'randName should be non-empty');
        t.assert.ok(
            /^[a-z0-9-]+$/.test(name),
            `randName should be lowercase, digits and dashes only, got: ${name}`,
        );
    },

    'randName produces a fresh name each call': async (t) => {
        const a = t.puter.randName();
        const b = t.puter.randName();
        t.assert.ok(a !== b, 'two randName calls should differ');
    },

    'randName honours a custom separator': async (t) => {
        const name = t.puter.randName('_');
        t.assert.ok(
            name.includes('_') && !name.includes('-'),
            `custom separator should be used throughout, got: ${name}`,
        );
    },

    'env reports the runtime environment': async (t) => {
        const env = t.puter.env;
        t.assert.ok(
            ['web', 'app', 'gui', 'nodejs', 'web-worker', 'service-worker'].includes(
                env,
            ),
            `env should be a known environment, got: ${env}`,
        );
    },
});
