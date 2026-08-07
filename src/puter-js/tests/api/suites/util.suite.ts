import { suite } from '../harness/types.ts';
import type { TestContext } from '../harness/types.ts';

/**
 * SDK internals that are deliberately absent from the public `.d.ts` but are
 * real behaviour worth pinning: token normalisation, JWT claim extraction and
 * the stored-token/origin rule that decides whether a token may be replayed.
 */
type PuterInternals = {
    normalizeAuthTokenCandidate: (value: unknown) => string | null;
    normalizeStringCandidate: (value: unknown) => string | null;
    decodeJwtPayload: (value: unknown) => Record<string, unknown> | null;
    decodeCompressedAppID: (value: unknown) => string | null;
    getAppIDFromAuthToken: (value: unknown) => string | null;
    _storedTokenUsableForCurrentOrigin: (boundOrigin: string | null) => boolean;
    on: (event: string, handler: (payload: unknown) => void) => () => void;
    off: (event: string, handler: (payload: unknown) => void) => void;
    apiCallLogger: {
        isEnabled: () => boolean;
        getStats: () => { enabled: boolean; config: Record<string, unknown> };
    };
    util: {
        rpc: {
            getDehydrator: () => { dehydrate: (value: unknown) => never };
            getHydrator: (config: { target: unknown }) => {
                hydrate: (value: unknown) => never;
            };
            registerCallback: (fn: () => void) => number;
            send: (target: unknown, id: number, ...args: unknown[]) => void;
        };
    };
};

const internals = (t: TestContext) => t.puter as unknown as PuterInternals;

// Signatures are never verified client-side, so a hand-built token is enough
// to pin which claim the app id is read from.
const jwt = (payload: string) =>
    `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.not-a-signature`;

// { "app_uid": "app-11112222-3333-4444-5555-666677778888" }
const APP_UID_JWT = jwt(
    'eyJhcHBfdWlkIjoiYXBwLTExMTEyMjIyLTMzMzMtNDQ0NC01NTU1LTY2NjY3Nzc3ODg4OCJ9',
);
// { "au": "ABEiM0RVZneImaq7zN3u/w==" } — the compressed 16-byte app id.
const COMPRESSED_APP_UID_JWT = jwt('eyJhdSI6IkFCRWlNMFJWWm5lSW1hcTd6TjN1L3c9PSJ9');
const COMPRESSED_APP_UID = 'ABEiM0RVZneImaq7zN3u/w==';
const EXPANDED_APP_UID = 'app-00112233-4455-6677-8899-aabbccddeeff';

/**
 * puter.js utility helpers (`puter.randName`, `puter.env`), the token/app-id
 * decoding the SDK bootstrap relies on, and `puter.util.rpc`. These are pure
 * client-side helpers, so they run identically on every platform. DOM-bound
 * utilities like `puter.print` are covered by the browser fixtures, not here.
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

    // -- Auth token normalisation --

    'auth token normalisation trims and rejects placeholder values': async (t) => {
        const p = internals(t);
        t.assert.equal(p.normalizeAuthTokenCandidate('  a-token  '), 'a-token');
        t.assert.equal(p.normalizeAuthTokenCandidate(''), null);
        t.assert.equal(p.normalizeAuthTokenCandidate('   '), null);
        // A stringified null/undefined is what a naive localStorage write
        // leaves behind; it must never be treated as a credential.
        t.assert.equal(p.normalizeAuthTokenCandidate('null'), null);
        t.assert.equal(p.normalizeAuthTokenCandidate('undefined'), null);
        t.assert.equal(p.normalizeAuthTokenCandidate(undefined), null);
        t.assert.equal(p.normalizeAuthTokenCandidate(42), null);
    },

    'string normalisation trims and rejects non-strings': async (t) => {
        const p = internals(t);
        t.assert.equal(p.normalizeStringCandidate('  x  '), 'x');
        t.assert.equal(p.normalizeStringCandidate('  '), null);
        t.assert.equal(p.normalizeStringCandidate(null), null);
        t.assert.equal(p.normalizeStringCandidate(7), null);
    },

    // -- JWT claim decoding --

    'decoding a session token exposes its claims': async (t) => {
        const payload = internals(t).decodeJwtPayload(t.env.users.user.token);
        t.assert.ok(payload, 'a session token should decode to a payload');
        t.assert.equal(payload!.t, 's', 'session tokens carry a session type');
        t.assert.equal(payload!.v, '2', 'test tokens are v2 tokens');
        t.assert.equal(typeof payload!.iat, 'number');
    },

    'decoding a malformed token yields null rather than throwing': async (t) => {
        const p = internals(t);
        t.assert.equal(p.decodeJwtPayload('no-dots-here'), null);
        t.assert.equal(p.decodeJwtPayload('header.$$$not-base64$$$.sig'), null);
        // A well-formed base64 segment whose contents are not JSON.
        t.assert.equal(p.decodeJwtPayload('header.bm90LWpzb24.sig'), null);
        // A JSON scalar is not an object payload.
        t.assert.equal(p.decodeJwtPayload('header.MTIz.sig'), null);
        t.assert.equal(p.decodeJwtPayload(null), null);
        t.assert.equal(p.decodeJwtPayload(123), null);
    },

    'an app id is read from the uncompressed token claim': async (t) => {
        t.assert.equal(
            internals(t).getAppIDFromAuthToken(APP_UID_JWT),
            'app-11112222-3333-4444-5555-666677778888',
        );
    },

    'an app id compressed into the auth scope is expanded': async (t) => {
        t.assert.equal(
            internals(t).getAppIDFromAuthToken(COMPRESSED_APP_UID_JWT),
            EXPANDED_APP_UID,
        );
    },

    'a plain session token carries no app identity': async (t) => {
        t.assert.equal(
            internals(t).getAppIDFromAuthToken(t.env.users.user.token),
            null,
        );
        t.assert.equal(internals(t).getAppIDFromAuthToken('not-a-jwt'), null);
    },

    'compressed app ids are only expanded from exactly 16 bytes': async (t) => {
        const p = internals(t);
        t.assert.equal(p.decodeCompressedAppID(COMPRESSED_APP_UID), EXPANDED_APP_UID);
        // An already-expanded uid is passed through untouched.
        t.assert.equal(
            p.decodeCompressedAppID('app-11112222-3333-4444-5555-666677778888'),
            'app-11112222-3333-4444-5555-666677778888',
        );
        t.assert.equal(p.decodeCompressedAppID('AAAA'), null, 'three bytes');
        t.assert.equal(p.decodeCompressedAppID(''), null);
        t.assert.equal(p.decodeCompressedAppID('   '), null);
        t.assert.equal(p.decodeCompressedAppID(null), null);
    },

    // -- Stored token / origin binding --

    'a stored token is only replayable to the origin it was bound to': async (t) => {
        const p = internals(t);
        t.assert.equal(
            p._storedTokenUsableForCurrentOrigin(t.puter.APIOrigin),
            true,
            'a token bound to the current origin is usable',
        );
        t.assert.equal(
            p._storedTokenUsableForCurrentOrigin('https://api.attacker.example'),
            false,
            'a token bound elsewhere must not be replayed here',
        );
        // An unbound (legacy) token is honored only against the default origin,
        // which is what the current origin is in this environment.
        t.assert.equal(
            p._storedTokenUsableForCurrentOrigin(null),
            t.puter.APIOrigin === t.puter.defaultAPIOrigin,
        );
    },

    // -- Event registration --

    'on returns a disposer and off ignores unknown handlers': async (t) => {
        const p = internals(t);
        const handler = () => {};
        const dispose = p.on('util-suite-event', handler);
        t.assert.equal(typeof dispose, 'function');
        // Removing a handler that was never registered is a no-op, as is
        // removing one for an event nobody ever registered for.
        p.off('util-suite-event', () => {});
        p.off('util-suite-never-registered', handler);
        dispose();
        // Disposing twice must not throw.
        dispose();
    },

    'auth-state subscribers are notified until they unsubscribe': async (t) => {
        let calls = 0;
        const unsubscribe = t.puter.onAuthStateChanged(() => {
            calls++;
        });
        // Re-setting the same origin is a state change as far as the SDK is
        // concerned, and is the cheapest way to drive the notification.
        t.puter.setAPIOrigin(t.puter.APIOrigin);
        t.assert.equal(calls, 1);
        unsubscribe();
        t.puter.setAPIOrigin(t.puter.APIOrigin);
        t.assert.equal(calls, 1, 'an unsubscribed listener must not be called');
    },

    'a throwing auth-state subscriber does not stop the others': async (t) => {
        let reached = false;
        const unsubscribeBad = t.puter.onAuthStateChanged(() => {
            throw new Error('listener blew up');
        });
        const unsubscribeGood = t.puter.onAuthStateChanged(() => {
            reached = true;
        });
        try {
            t.puter.setAPIOrigin(t.puter.APIOrigin);
        } finally {
            unsubscribeBad();
            unsubscribeGood();
        }
        t.assert.equal(reached, true);
    },

    // -- API call logging --

    'API logging can be enabled, reconfigured and disabled': async (t) => {
        const { apiCallLogger } = internals(t);
        t.assert.equal(apiCallLogger.isEnabled(), false, 'off by default');
        try {
            t.puter.enableAPILogging({ tag: 'util-suite' } as never);
            t.assert.equal(apiCallLogger.isEnabled(), true);
            t.assert.deepEqual(apiCallLogger.getStats(), {
                enabled: true,
                config: { enabled: true, tag: 'util-suite' },
            });
            // A real call while logging is on exercises the logging branches
            // in the request path.
            const user = await t.puter.auth.whoami();
            t.assert.equal(user.username, t.env.users.user.username);

            t.puter.configureAPILogging({ tag: 'util-suite-2' } as never);
            t.assert.deepEqual(apiCallLogger.getStats(), {
                enabled: true,
                config: { enabled: true, tag: 'util-suite-2' },
            });
        } finally {
            t.puter.disableAPILogging();
        }
        t.assert.equal(apiCallLogger.isEnabled(), false);
    },

    // -- Cross-document RPC (puter.util.rpc) --

    'rpc replaces functions with ids and hydrates them back into stubs': async (
        t,
    ) => {
        const posted: Array<Record<string, unknown>> = [];
        const target = {
            postMessage: (message: Record<string, unknown>) => {
                posted.push(message);
            },
        };
        const { rpc } = internals(t).util;

        const dehydrated = rpc.getDehydrator().dehydrate({
            plain: 1,
            callback: () => {},
            list: [() => {}, 'literal'],
        }) as unknown as {
            plain: number;
            callback: { $SCOPE: string; id: number };
            list: [{ $SCOPE: string; id: number }, string];
        };

        t.assert.equal(dehydrated.plain, 1, 'plain values survive untouched');
        t.assert.equal(dehydrated.list[1], 'literal');
        t.assert.equal(typeof dehydrated.callback.$SCOPE, 'string');
        t.assert.equal(typeof dehydrated.callback.id, 'number');
        t.assert.ok(
            dehydrated.callback.id !== dehydrated.list[0].id,
            'each function gets its own callback id',
        );

        const hydrated = rpc.getHydrator({ target }).hydrate(dehydrated) as unknown as {
            plain: number;
            callback: (...args: unknown[]) => void;
            list: [(...args: unknown[]) => void, string];
        };
        t.assert.equal(hydrated.plain, 1);
        t.assert.equal(typeof hydrated.callback, 'function');
        t.assert.equal(typeof hydrated.list[0], 'function');
        t.assert.equal(hydrated.list[1], 'literal');

        hydrated.callback(1, 'two');
        t.assert.equal(posted.length, 1);
        t.assert.equal(posted[0].$SCOPE, dehydrated.callback.$SCOPE);
        t.assert.equal(posted[0].id, dehydrated.callback.id);
        t.assert.deepEqual(posted[0].args, [1, 'two']);
    },

    // Both sides rebuild objects out of values the *other* document sent, so a
    // literal `__proto__` key must land as an own property instead of swapping
    // the prototype of the object handed back to our own caller.
    'rpc rebuilds a __proto__ key as data instead of polluting prototypes': async (
        t,
    ) => {
        const { rpc } = internals(t).util;
        const hostile = JSON.parse('{"__proto__":{"polluted":true},"safe":1}');

        for (const rebuilt of [
            rpc.getDehydrator().dehydrate(hostile) as unknown as Record<string, unknown>,
            rpc
                .getHydrator({ target: { postMessage: () => {} } })
                .hydrate(hostile) as unknown as Record<string, unknown>,
        ]) {
            t.assert.equal(rebuilt.safe, 1);
            t.assert.equal(
                rebuilt.polluted,
                undefined,
                'the hostile key must not become an inherited property',
            );
            t.assert.equal(
                Object.prototype.hasOwnProperty.call(rebuilt, '__proto__'),
                true,
                '__proto__ should be carried as an own data property',
            );
        }
        t.assert.equal(
            ({} as Record<string, unknown>).polluted,
            undefined,
            'Object.prototype must be untouched',
        );
    },

    // -- puter.print --

    // `print` appends straight into `document.body`, so it is only
    // exercisable where a document exists. Its escaping rules are the
    // reason it is worth pinning: without `escapeHTML`/`code` the argument
    // is deliberately written as markup, and with either one it must not be.
    'print escapes markup only when asked to': {
        platforms: ['browser'],
        fn: async (t) => {
            const body = document.body;
            const original = body.innerHTML;
            try {
                body.innerHTML = '';
                t.puter.print('<b>bold</b>');
                t.assert.equal(body.innerHTML, '<b>bold</b>');

                body.innerHTML = '';
                t.puter.print('<img src=x onerror="alert(1)">', {
                    escapeHTML: true,
                });
                // Angle brackets stay escaped when the document is read
                // back, which is what stops the tag from being live markup.
                t.assert.equal(
                    body.innerHTML,
                    '&lt;img src=x onerror="alert(1)"&gt;',
                );

                body.innerHTML = '';
                t.puter.print("a & b <i>'x'</i>", { code: true });
                t.assert.equal(
                    body.innerHTML,
                    '<code><pre>a &amp; b &lt;i&gt;\'x\'&lt;/i&gt;</pre></code>',
                );
            } finally {
                body.innerHTML = original;
            }
        },
    },

    // `exit` reports back to the host environment through the embedder, so it
    // needs a window with a `parent` to post to.
    'exit reports a non-numeric status code as failure': {
        platforms: ['browser'],
        fn: async (t) => {
            const received: Array<{ msg?: string; statusCode?: unknown }> = [];
            const listener = (event: MessageEvent) => {
                if (event.data?.msg === 'exit') received.push(event.data);
            };
            globalThis.addEventListener('message', listener);
            try {
                t.puter.exit();
                t.puter.exit(3);
                (t.puter.exit as (code: unknown) => void)('not-a-number');
                // postMessage delivery is a task, not synchronous.
                await new Promise((resolve) => setTimeout(resolve, 100));
            } finally {
                globalThis.removeEventListener('message', listener);
            }
            t.assert.deepEqual(
                received.map((m) => m.statusCode),
                [0, 3, 1],
                'a non-numeric status code is reported as 1',
            );
        },
    },

    'rpc hands out a fresh callback id per registration': async (t) => {
        const posted: Array<Record<string, unknown>> = [];
        const target = {
            postMessage: (message: Record<string, unknown>) => {
                posted.push(message);
            },
        };
        const { rpc } = internals(t).util;
        const first = rpc.registerCallback(() => {});
        const second = rpc.registerCallback(() => {});
        t.assert.ok(first !== second, 'ids must be unique');

        rpc.send(target, second, 'payload');
        t.assert.equal(posted.length, 1);
        t.assert.equal(posted[0].id, second);
        t.assert.deepEqual(posted[0].args, ['payload']);
    },
});
