import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

/** SDK internals the public `.d.ts` does not declare. */
type PuterInternals = {
    env: string;
    whoami: { username: string } | undefined;
    _cache: {
        get: (key: string) => unknown;
        flushall: () => void;
    };
    checkAndUpdateGUIFScache: () => void;
    request_rao_: () => Promise<unknown>;
};

const internals = (t: TestContext) => t.puter as unknown as PuterInternals;

/** Wait until `read` returns something, or give up. */
const settle = async (read: () => unknown, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = read();
        if (value) return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return undefined;
};

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

    'drivers.get hands back the same handle per interface': async (t) => {
        const first = await t.puter.drivers.get('puter-kvstore');
        const second = await t.puter.drivers.get('puter-kvstore');
        t.assert.ok(first === second, 'the handle should be cached');
        const other = await t.puter.drivers.get('puter-apps');
        t.assert.ok(first !== other, 'a different interface gets its own handle');
    },

    'a driver handle resolves the response envelope as sent': async (t) => {
        const driver = await t.puter.drivers.get('puter-kvstore');
        const set = (await driver.call('set', {
            key: 'system-suite-driver-handle',
            value: 'handle value',
        })) as { success: boolean; result: unknown };
        t.assert.equal(set.success, true);
        t.assert.equal(set.result, true);

        const got = (await driver.call('get', {
            key: 'system-suite-driver-handle',
        })) as { success: boolean; result: unknown };
        t.assert.equal(got.success, true);
        t.assert.equal(got.result, 'handle value');
    },

    // The implementation slot predates interface-level defaults; the backend
    // resolves it, so the SDK accepts and ignores it.
    'drivers.call still accepts the legacy four-argument form': async (t) => {
        await t.puter.kv.set('system-suite-four-arg', 'four');
        const result = (await t.puter.drivers.call(
            'puter-kvstore',
            'puter-kvstore',
            'get',
            { key: 'system-suite-four-arg' },
        )) as { success: boolean; result: unknown };
        t.assert.equal(result.success, true);
        t.assert.equal(result.result, 'four');
    },

    'drivers.call with only an interface calls the same-named method': async (t) => {
        const result = (await t.puter.drivers.call('puter-kvstore', {
            key: 'system-suite-two-arg',
        })) as { code?: string; message?: string };
        t.assert.equal(result.code, 'not_found');
        t.assert.equal(
            result.message,
            "Method 'puter-kvstore' not found on driver 'puter-kvstore'",
        );
    },

    // Recording an app open is idempotent per SDK instance: setAuthToken runs
    // more than once during sign-in and must not re-record each time.
    'the app-open record is only requested once per SDK instance': async (t) => {
        const puter = t.puter as unknown as {
            request_rao_: () => Promise<unknown>;
        };
        await puter.request_rao_();
        t.assert.equal(
            await puter.request_rao_(),
            undefined,
            'a repeat request should short-circuit',
        );
    },

    // -- Email --

    // The email driver ships as an extension, so this deployment has none.
    // What matters here is that the driver's error reaches the caller
    // unchanged rather than being swallowed or re-wrapped.
    'email.send passes a driver error through unchanged': async (t) => {
        const error = (await t.assert.rejects(() =>
            t.puter.email.send('nobody@example.com', 'subject', 'body'),
        )) as { code?: string; message?: string };
        t.assert.equal(error.code, 'not_found');
        t.assert.equal(
            error.message,
            'Driver not found: puter-email:(no default)',
        );
    },

    'email.send reports failures to a positional error callback': async (t) => {
        let reported: { code?: string } | null = null;
        await t.assert.rejects(() =>
            (
                t.puter.email.send as (
                    to: string,
                    subject: string,
                    body: string,
                    success?: unknown,
                    error?: (reason: unknown) => void,
                ) => Promise<unknown>
            )('nobody@example.com', 'subject', 'body', undefined, (reason) => {
                reported = reason as { code?: string };
            }),
        );
        t.assert.ok(reported, 'the error callback should have run');
        t.assert.equal(reported!.code, 'not_found');
    },

    'email.send reports failures to an error callback in the options form': async (
        t,
    ) => {
        let reported: { code?: string } | null = null;
        await t.assert.rejects(() =>
            t.puter.email.send({
                to: 'nobody@example.com',
                subject: 'subject',
                text: 'body',
                error: (reason: unknown) => {
                    reported = reason as { code?: string };
                },
            } as never),
        );
        t.assert.ok(reported, 'the error callback should have run');
        t.assert.equal(reported!.code, 'not_found');
    },

    // -- Transport failures --

    // Reads are retried on a fixed backoff before giving up, and a transport
    // failure surfaces as a TypeError (fetch semantics) rather than an
    // `ok: false` response.
    'an unreachable API origin fails as a network error after retrying': async (
        t,
    ) => {
        const realOrigin = t.puter.APIOrigin;
        const deadOrigin = 'http://system-suite-unreachable.invalid';
        try {
            t.puter.setAPIOrigin(deadOrigin);
            const started = Date.now();
            const error = (await t.assert.rejects(() =>
                t.puter.auth.whoami(),
            )) as Error;
            t.assert.ok(
                error instanceof TypeError,
                `expected a TypeError, got ${error}`,
            );
            t.assert.equal(
                error.message,
                `Network request to ${deadOrigin}/whoami failed`,
            );
            // The fixed schedule ramps to a 2s ceiling, so a run that gave up
            // immediately would mean the retry loop never engaged.
            t.assert.ok(
                Date.now() - started > 3_000,
                'the request should have been retried before failing',
            );
        } finally {
            t.puter.setAPIOrigin(realOrigin);
        }
    },

    // A driver call is a POST, so it is never retried; both driver result
    // shapes have to report the transport failure to their caller rather
    // than resolving something that looks like a response.
    'driver calls surface a transport failure instead of a response': async (t) => {
        const realOrigin = t.puter.APIOrigin;
        try {
            t.puter.setAPIOrigin('http://system-suite-driver-unreachable.invalid');
            // `puter.drivers.call` resolves the envelope, so a transport
            // failure is the one thing it throws.
            const envelopeError = (await t.assert.rejects(() =>
                t.puter.drivers.call('puter-kvstore', 'set', {
                    key: 'system-suite-dead-origin',
                    value: 'x',
                }),
            )) as Error;
            t.assert.ok(
                envelopeError instanceof TypeError,
                `expected a TypeError, got ${envelopeError}`,
            );
            // The module-level driver helpers reject with the failed request
            // itself, which carries no HTTP status.
            const callError = (await t.assert.rejects(() =>
                t.puter.email.send('nobody@example.com', 's', 'b'),
            )) as { status?: number };
            t.assert.equal(callError.status, 0);
        } finally {
            t.puter.setAPIOrigin(realOrigin);
        }
    },

    // -- Logger --

    'the logger prefixes messages with the fields it was given': async (t) => {
        const logger = (
            t.puter as unknown as {
                logger: {
                    fields: (extra: Record<string, unknown>) => unknown;
                    info: (...args: unknown[]) => void;
                    warn: (...args: unknown[]) => void;
                    error: (...args: unknown[]) => void;
                    debug: (...args: unknown[]) => void;
                    on: (category: string) => void;
                };
            }
        ).logger;
        const captured: unknown[][] = [];
        const real = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
        };
        const record = (...args: unknown[]) => captured.push(args);
        try {
            console.log = record;
            console.warn = record;
            console.error = record;
            console.debug = record;

            logger.info('plain');
            const scoped = logger.fields({ area: 'system-suite' }) as typeof logger;
            scoped.warn('warned');
            scoped.error('errored');
            scoped.debug('debugged');
            // Enabling a log category must not disturb the field prefix.
            scoped.on('system-suite-category');
            scoped.info('after-on');
        } finally {
            console.log = real.log;
            console.warn = real.warn;
            console.error = real.error;
            console.debug = real.debug;
        }

        // A logger with no fields prints no prefix at all.
        t.assert.deepEqual(captured[0], ['plain']);
        t.assert.deepEqual(captured[1], ['[area=system-suite]', 'warned']);
        t.assert.deepEqual(captured[2], ['[area=system-suite]', 'errored']);
        t.assert.deepEqual(captured[3], ['[area=system-suite]', 'debugged']);
        t.assert.deepEqual(captured[4], ['[area=system-suite]', 'after-on']);
    },

    'the developer console CTA can be silenced with puter.quiet': async (t) => {
        const p = t.puter as unknown as {
            quiet: boolean;
            printDevCTA: () => void;
        };
        const wasQuiet = p.quiet;
        const realLog = console.log;
        let calls = 0;
        try {
            console.log = () => {
                calls++;
            };
            p.quiet = false;
            p.printDevCTA();
            const whenLoud = calls;
            calls = 0;
            p.quiet = true;
            p.printDevCTA();
            console.log = realLog;
            t.assert.ok(whenLoud > 0, 'the CTA should be printed by default');
            t.assert.equal(calls, 0, 'puter.quiet must silence the CTA');
        } finally {
            console.log = realLog;
            p.quiet = wasQuiet;
        }
    },

    // -- GUI filesystem cache warming --

    'the GUI cache warmer only runs inside the GUI for a known user': async (t) => {
        const p = internals(t);
        const realEnv = p.env;
        const realWhoami = p.whoami;
        const home = `/${t.env.users.user.username}`;
        try {
            p._cache.flushall();
            // Outside the GUI the desktop owns no cache to warm.
            p.checkAndUpdateGUIFScache();
            t.assert.equal(p._cache.get(`item:${home}`), undefined);

            // Inside the GUI but before the user is known there is nothing
            // to build the paths from.
            p.env = 'gui';
            p.whoami = undefined;
            p.checkAndUpdateGUIFScache();
            t.assert.equal(p._cache.get(`item:${home}`), undefined);
        } finally {
            p.env = realEnv;
            p.whoami = realWhoami;
        }
    },

    'the GUI cache warmer fetches the common directories once': async (t) => {
        const p = internals(t);
        const realEnv = p.env;
        const realWhoami = p.whoami;
        const home = `/${t.env.users.user.username}`;
        try {
            p._cache.flushall();
            p.env = 'gui';
            p.whoami = { username: t.env.users.user.username };
            p.checkAndUpdateGUIFScache();

            const homeItem = (await settle(() =>
                p._cache.get(`item:${home}`),
            )) as { name?: string; is_dir?: boolean } | undefined;
            t.assert.ok(homeItem, 'the home item should be cached');
            t.assert.equal(homeItem!.name, t.env.users.user.username);
            t.assert.equal(homeItem!.is_dir, true);

            const desktopItem = (await settle(() =>
                p._cache.get(`item:${home}/Desktop`),
            )) as { name?: string } | undefined;
            t.assert.equal(desktopItem?.name, 'Desktop');

            const homeListing = (await settle(() =>
                p._cache.get(`readdir:${home}`),
            )) as Array<{ name: string }> | undefined;
            t.assert.ok(
                Array.isArray(homeListing),
                'the home listing should be cached as an array',
            );
            t.assert.ok(
                homeListing!.some((entry) => entry.name === 'Desktop'),
                'the cached home listing should contain Desktop',
            );

            // A second pass finds everything warm and leaves it in place.
            // The seeded user has no Public folder, so this also covers the
            // warmer surviving a directory it cannot read.
            p.checkAndUpdateGUIFScache();
            await new Promise((resolve) => setTimeout(resolve, 250));
            t.assert.equal(
                (p._cache.get(`item:${home}`) as { name?: string }).name,
                t.env.users.user.username,
            );
        } finally {
            p.env = realEnv;
            p.whoami = realWhoami;
            p._cache.flushall();
        }
    },

    // Losing connectivity purges the cache so a reconnect doesn't serve
    // entries that went stale while offline. Only a browser has the
    // online/offline events and the `navigator.onLine` the watcher reads.
    'losing connectivity purges the filesystem cache': {
        platforms: ['browser'],
        fn: async (t) => {
            const p = internals(t);
            const home = `/${t.env.users.user.username}`;
            const onLine = Object.getOwnPropertyDescriptor(
                Navigator.prototype,
                'onLine',
            );
            try {
                await t.puter.fs.stat({ path: home });
                t.assert.ok(
                    p._cache.get(`item:${home}`),
                    'the stat should have been cached',
                );

                Object.defineProperty(navigator, 'onLine', {
                    get: () => false,
                    configurable: true,
                });
                globalThis.dispatchEvent(new Event('offline'));
                t.assert.equal(
                    p._cache.get(`item:${home}`),
                    undefined,
                    'going offline should have purged the cache',
                );
            } finally {
                delete (navigator as unknown as Record<string, unknown>).onLine;
                if (onLine) {
                    Object.defineProperty(Navigator.prototype, 'onLine', onLine);
                }
                // Restore the watcher's own view of the connection.
                globalThis.dispatchEvent(new Event('online'));
            }
        },
    },

    // -- App identity --

    'setAppID records the app and derives its AppData path': async (t) => {
        const original = t.puter.appID;
        try {
            t.puter.setAppID('app-system-suite-0001');
            t.assert.equal(t.puter.appID, 'app-system-suite-0001');
            t.assert.equal(
                t.puter.appDataPath,
                '~/AppData/app-system-suite-0001',
            );
        } finally {
            t.puter.setAppID(original as string);
        }
        t.assert.equal(t.puter.appID, original);
    },
});
