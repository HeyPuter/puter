import { suite, type TestContext } from '../harness/types.ts';

// `puter.events` rides a socket; every runtime the suite runs on (node,
// browser, workerd) carries one, so a subscribe that fails is a failure here.

/** Short enough that a runtime that cannot connect fails fast, not at 30 s. */
const SUBSCRIBE_TIMEOUT_MS = 5000;
const DELIVERY_TIMEOUT_MS = 15000;
/** Deliveries are coalesced server-side over 250 ms. */
const QUIET_MS = 2000;

type Delivered = {
    id: string;
    subject: string;
    op: string;
    uid?: string;
    path?: string;
    key?: string;
    self?: boolean;
    ts: number;
    seq?: number;
};

type Subscription = Awaited<ReturnType<TestContext['puter']['events']['onLocal']>>;

const codeOf = (error: unknown): string | undefined =>
    (error as { code?: string } | undefined)?.code;

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const waitFor = async (
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number,
): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await condition()) return true;
        await sleep(50);
    }
    return await condition();
};

const unique = (prefix: string): string =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A directory of this test's own to anchor a subscription on. */
const makeDir = async (t: TestContext, name: string): Promise<string> => {
    const path = `/${t.env.users.user.username}/${unique(name)}`;
    await t.puter.fs.mkdir(path, { createMissingParents: true });
    return path;
};

const open = (
    t: TestContext,
    subject: string,
    handler: (event: Delivered) => void,
): Promise<Subscription> =>
    t.puter.events.onLocal(subject, ({ event }) => handler(event as Delivered), {
        timeout: SUBSCRIBE_TIMEOUT_MS,
    });

/** A handler that closes over nothing, so the free-variable scan accepts it. */
const HANDLER = '({ event, ctx }) => { console.log(event.path, ctx.label); }';
const OTHER_HANDLER = '({ event, ctx }) => { console.log(ctx.label, event.uid); }';

/** An app of this account's own, so its handlers are the caller's to publish. */
const makeApp = async (t: TestContext): Promise<string> => {
    const name = unique('events-handlers');
    const app = await t.puter.apps.create(name, `https://example.com/${name}`);
    return (app as unknown as { uid: string }).uid;
};

/**
 * A handler that closes over nothing and reports what it ran on through the
 * one thing it is allowed to reach. Published and subscribed as the same
 * function, so the hash the subscribe sends is the hash that was published.
 */
const RECORDING_HANDLER = async ({
    event,
    ctx,
}: {
    event: { path?: string };
    ctx: Record<string, unknown>;
}) => {
    const seen = ((globalThis as Record<string, unknown>).puterEventsSeen ??
        []) as unknown[];
    seen.push({ path: event.path, label: ctx.label });
    (globalThis as Record<string, unknown>).puterEventsSeen = seen;
};

const recorded = (): Array<{ path?: string; label?: unknown }> =>
    ((globalThis as Record<string, unknown>).puterEventsSeen ?? []) as Array<{
        path?: string;
        label?: unknown;
    }>;

/**
 * A broadcast handler, reporting whether it was handed the same environment a
 * `single` handler gets — `user` and `fetch` are not conditioned on an `ack`
 * existing, so every consumer of a broadcast delivery gets them too.
 */
const BROADCAST_ENV_HANDLER = async ({
    event,
    ctx,
    user,
    fetch,
}: {
    event: { path?: string };
    ctx: Record<string, unknown>;
    user: unknown;
    fetch: unknown;
}) => {
    const seen = ((globalThis as Record<string, unknown>).puterEventsBroadcastEnv ??
        []) as unknown[];
    seen.push({
        path: event.path,
        label: ctx.label,
        hasUser: user !== undefined && user !== null,
        hasFetch: typeof fetch === 'function',
    });
    (globalThis as Record<string, unknown>).puterEventsBroadcastEnv = seen;
};

const recordedBroadcastEnv = (): Array<{
    path?: string;
    label?: unknown;
    hasUser?: boolean;
    hasFetch?: boolean;
}> =>
    ((globalThis as Record<string, unknown>).puterEventsBroadcastEnv ?? []) as Array<{
        path?: string;
        label?: unknown;
        hasUser?: boolean;
        hasFetch?: boolean;
    }>;

/** Run as the app rather than as the account, then put the session back. */
const asApp = async <T>(
    t: TestContext,
    appUid: string,
    run: () => Promise<T>,
): Promise<T> => {
    const response = await fetch(`${t.env.apiOrigin}/auth/get-user-app-token`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${t.env.users.user.token}`,
        },
        body: JSON.stringify({ app_uid: appUid }),
    });
    const { token } = (await response.json()) as { token: string };
    // setAuthToken adopts the app identity from an app token's claims and never
    // drops it, so the shared instance would keep resolving relative paths
    // under ~/AppData/<app> for every later test unless it is put back here.
    const sdk = t.puter as unknown as { appID?: string; appDataPath?: string };
    const { appID, appDataPath } = sdk;
    t.puter.setAuthToken(token);
    try {
        return await run();
    } finally {
        t.puter.setAuthToken(t.env.users.user.token);
        sdk.appID = appID;
        sdk.appDataPath = appDataPath;
    }
};


/** One notification in this account's own mailbox, written through the driver. */
const postNotification = async (t: TestContext, title: string): Promise<void> => {
    // `share.received` is a registered, account-audience, unscoped type —
    // this helper only cares that some notification lands in the mailbox.
    await t.puter.drivers.call('puter-notifications', 'es:notification', 'create', {
        object: { value: { type: 'share.received', title } },
    });
};

type FetchedNotification = Awaited<
    ReturnType<TestContext['puter']['events']['fetch']>
>['items'][number];

/** Every notification in the account's mailbox, following the cursor. */
const readAllNotifications = async (
    t: TestContext,
): Promise<FetchedNotification[]> => {
    const items: FetchedNotification[] = [];
    let after: string | undefined;
    // Bounded: a mailbox is capped by its retention window, and a runaway
    // cursor loop would hang the suite rather than fail it.
    for (let page = 0; page < 20; page++) {
        const result = await t.puter.events.fetch({
            subject: 'notif:account',
            limit: 200,
            ...(after ? { after } : {}),
        });
        items.push(...result.items);
        if (!result.cursor) break;
        after = result.cursor;
    }
    return items;
};

export default suite('events', {
    'exposes onLocal': async (t) => {
        t.assert.ok(t.puter.events, 'puter.events is registered');
        t.assert.equal(typeof t.puter.events.onLocal, 'function');
    },

    'exposes the persistent surface': async (t) => {
        for (const method of [
            'onPersistent',
            'unsubscribe',
            'list',
            'fetch',
        ] as const) {
            t.assert.equal(
                typeof t.puter.events[method],
                'function',
                `puter.events.${method} is a function`,
            );
        }
        for (const method of ['publish', 'publishAll', 'list', 'remove'] as const) {
            t.assert.equal(
                typeof t.puter.events.handlers[method],
                'function',
                `puter.events.handlers.${method} is a function`,
            );
        }
    },

    'rejects a subject that is not a non-empty string': async (t) => {
        for (const subject of [undefined, null, '', '   ', 42, {}]) {
            const error = await t.assert.rejects(
                () =>
                    t.puter.events.onLocal(
                        subject as unknown as string,
                        () => {},
                    ),
                `subject ${JSON.stringify(subject)} should be rejected`,
            );
            t.assert.equal(codeOf(error), 'invalid_subject');
        }
    },

    'rejects a handler that is not a function': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.onLocal(
                `fs:/${t.env.users.user.username}`,
                undefined as unknown as () => void,
            ),
        );
        t.assert.equal(codeOf(error), 'invalid_handler');
    },

    'delivers the projected event shape': async (t) => {
        const dir = await makeDir(t, 'events-shape');
        const seen: Delivered[] = [];

        const sub = await open(t, `fs:${dir}`, (event) => seen.push(event));
        if (!sub) return;

        try {
            t.assert.ok(sub.subId, 'a live subscription carries a server id');
            t.assert.equal(sub.subject, `fs:${dir}`);
            t.assert.equal(sub.anchor?.path, dir);

            const file = `${dir}/note.txt`;
            await t.puter.fs.write(file, 'hello');

            await waitFor(
                () => seen.some((event) => event.path === file),
                DELIVERY_TIMEOUT_MS,
            );
            const event = seen.find((e) => e.path === file);
            t.assert.ok(event, `no delivery for ${file}; saw ${JSON.stringify(seen)}`);
            t.assert.deepEqual(
                Object.keys(event as Delivered).sort(),
                ['id', 'op', 'path', 'self', 'seq', 'subject', 'ts', 'uid'],
                'the delivered event carries exactly the projected fields',
            );
            t.assert.equal(event?.self, true, 'the writer is the subscriber');
            t.assert.ok(event?.uid, 'the event names the node');
            t.assert.ok(
                ['add', 'write'].includes(event?.op as string),
                `unexpected op: ${event?.op}`,
            );
        } finally {
            await sub.off();
        }
    },

    'off stops delivery and can be called more than once': async (t) => {
        const dir = await makeDir(t, 'events-off');
        const seen: Delivered[] = [];

        const sub = await open(t, `fs:${dir}`, (event) => seen.push(event));
        if (!sub) return;

        await sub.off();
        t.assert.equal(sub.subId, null, 'off clears the server id');
        // Teardown is idempotent, and never throws once the connection is gone.
        await sub.off();

        await t.puter.fs.write(`${dir}/after-off.txt`, 'quiet');
        await sleep(QUIET_MS);
        t.assert.deepEqual(seen, [], 'nothing is delivered after off()');
    },

    'several subscriptions share one connection': async (t) => {
        const watched = await makeDir(t, 'events-multi-a');
        const other = await makeDir(t, 'events-multi-b');
        const watchedSeen: Delivered[] = [];
        const otherSeen: Delivered[] = [];

        const first = await open(t, `fs:${watched}`, (e) => watchedSeen.push(e));
        if (!first) return;
        const second = await open(t, `fs:${other}`, (e) => otherSeen.push(e));
        if (!second) {
            await first.off();
            return;
        }

        try {
            t.assert.ok(
                first.subId !== second.subId,
                'each subscription gets its own id',
            );

            const file = `${watched}/only-here.txt`;
            await t.puter.fs.write(file, 'x');
            await waitFor(
                () => watchedSeen.some((event) => event.path === file),
                DELIVERY_TIMEOUT_MS,
            );

            t.assert.ok(
                watchedSeen.some((event) => event.path === file),
                'the subscription on the written directory hears it',
            );
            t.assert.deepEqual(
                otherSeen,
                [],
                'the subscription on the other directory hears nothing',
            );
        } finally {
            await first.off();
            await second.off();
        }
    },

    'resubscribes when the connection is rebuilt': async (t) => {
        const dir = await makeDir(t, 'events-reconnect');
        const seen: Delivered[] = [];

        const sub = await open(t, `fs:${dir}`, (event) => seen.push(event));
        if (!sub) return;

        try {
            const before = sub.subId;

            // Rebuilding auth state drops the socket the way a reconnect
            // does; the server's session subscriptions go with it.
            t.puter.setAPIOrigin(t.puter.APIOrigin);

            const back = await waitFor(
                () => sub.subId !== null && sub.subId !== before,
                DELIVERY_TIMEOUT_MS,
            );
            t.assert.ok(back, 'the subscription was re-established with a new id');

            const file = `${dir}/after-reconnect.txt`;
            await t.puter.fs.write(file, 'still listening');
            await waitFor(
                () => seen.some((event) => event.path === file),
                DELIVERY_TIMEOUT_MS,
            );
            t.assert.ok(
                seen.some((event) => event.path === file),
                'the same handler keeps receiving events after the rebuild',
            );
        } finally {
            await sub.off();
        }
    },

    'delivers a key-value change, exactly by default': async (t) => {
        const exact = unique('kv-exact');
        const nested = `${exact}-nested`;
        const exactSeen: Delivered[] = [];
        const widenedSeen: Delivered[] = [];

        const one = await open(t, `kv:${exact}`, (event) =>
            exactSeen.push(event),
        );
        if (!one) return;
        // A trailing `*` is what widens a subject to a prefix; without it the
        // key is matched exactly, which is the opposite of `kv.list()`.
        const many = await open(t, `kv:${exact}*`, (event) =>
            widenedSeen.push(event),
        );
        if (!many) {
            await one.off();
            return;
        }

        try {
            // The subject comes back fully qualified whichever form was sent.
            t.assert.ok(
                one.subject.startsWith('kv:') &&
                    one.subject.endsWith(`:${exact}`),
                `unexpected subject: ${one.subject}`,
            );
            t.assert.equal(one.anchor?.path, exact);

            await t.puter.kv.set(exact, { total: 1 });
            await t.puter.kv.set(nested, ['apple']);
            await waitFor(
                () => exactSeen.length > 0 && widenedSeen.length > 1,
                DELIVERY_TIMEOUT_MS,
            );

            const event = exactSeen[0];
            t.assert.ok(event, `no delivery for ${exact}`);
            t.assert.deepEqual(
                Object.keys(event as Delivered).sort(),
                ['id', 'key', 'op', 'self', 'seq', 'subject', 'ts'],
                'a kv delivery carries a key, not a uid and path',
            );
            t.assert.equal(event?.key, exact);
            t.assert.equal(event?.op, 'set');
            t.assert.equal(event?.self, true);

            t.assert.deepEqual(
                exactSeen.map((one) => one.key),
                [exact],
                `the exact subscription saw ${JSON.stringify(exactSeen.map((e) => e.key))}`,
            );
            t.assert.deepEqual(
                widenedSeen.map((one) => one.key).sort(),
                [exact, nested].sort(),
                `the widened subscription saw ${JSON.stringify(widenedSeen.map((e) => e.key))}`,
            );

            await t.puter.kv.del(exact);
            await t.puter.kv.del(nested);
        } finally {
            await one.off();
            await many.off();
        }
    },

    'passes server error codes through unchanged': async (t) => {
        const dir = await makeDir(t, 'events-errors');
        const cases: Array<[string, string]> = [
            // An op the subject grammar does not define.
            [`fs:${dir}:frobnicate`, 'invalid_subject_op'],
            // A pattern past the compile-cost bounds (16 segments).
            [`fs:${dir}/${'deep/'.repeat(20)}x`, 'invalid_subject_pattern'],
            // KV widens with a trailing `*` only.
            ['kv:ca*rt', 'invalid_kv_pattern'],
            // Another account's home: refused as absent, so the call cannot be
            // used to find out what exists.
            [
                `fs:/${t.env.users.other.username}/${unique('nope')}`,
                'subject_does_not_exist',
            ],
        ];

        for (const [subject, expected] of cases) {
            const error = await t.assert.rejects(
                () =>
                    t.puter.events.onLocal(subject, () => {}, {
                        timeout: SUBSCRIBE_TIMEOUT_MS,
                    }),
                `${subject} should be refused`,
            );
            t.assert.equal(
                codeOf(error),
                expected,
                `${subject} answered ${codeOf(error)}`,
            );
        }
    },

    // -- Persistent subscriptions ------------------------------------

    'refuses an inline handler with no name to publish it under': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.onPersistent({
                subject: `fs:/${t.env.users.user.username}`,
                handler: HANDLER,
            }),
        );
        t.assert.equal(codeOf(error), 'events_handler_name_required');
    },

    'refuses a handler that closes over something it cannot carry': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.onPersistent({
                subject: `fs:/${t.env.users.user.username}`,
                handlerName: 'ingestUpload',
                handler: '({ event }) => fetch(ingestUrl, { body: event.path })',
            }),
        );
        t.assert.equal(codeOf(error), 'events_handler_free_variable');
        t.assert.ok(
            (error as Error).message.includes('ingestUrl'),
            'the error names the identifier that could not be resolved',
        );
    },

    'refuses a context over the cap before the round trip': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.onPersistent({
                subject: `fs:/${t.env.users.user.username}`,
                context: { blob: 'x'.repeat(5000) },
            }),
        );
        t.assert.equal(codeOf(error), 'events_context_too_large');
    },

    'creates, lists and ends a persistent subscription': async (t) => {
        const dir = await makeDir(t, 'events-persistent');

        const sub = await t.puter.events.onPersistent({
            subject: `fs:${dir}`,
            context: { label: 'ingest', token: 'shhh-not-in-a-listing' },
        });

        try {
            t.assert.ok(sub.subId, 'the subscription carries a server id');
            t.assert.equal(sub.subject, `fs:${dir}`);
            t.assert.equal(sub.delivery, 'broadcast');
            t.assert.equal(sub.suspendedAt, null);

            const held = await t.puter.events.list();
            const listed = held.find((row) => row.subId === sub.subId);
            t.assert.ok(listed, 'the subscription is in the account`s listing');
            // The context is where an API key lives, so a listing reports its
            // shape and never its values.
            t.assert.deepEqual(listed?.contextKeys, ['label', 'token']);
            t.assert.ok(
                typeof listed?.contextHash === 'string' &&
                    listed.contextHash.length === 64,
                'the listing carries a content hash of the context',
            );
            t.assert.ok(
                ! JSON.stringify(listed).includes('shhh-not-in-a-listing'),
                'the listing carries no context values',
            );
        } finally {
            await t.puter.events.unsubscribe(sub.subId);
        }

        const after = await t.puter.events.list();
        t.assert.ok(
            ! after.some((row) => row.subId === sub.subId),
            'the subscription is gone once unsubscribed',
        );
    },

    'answers a listing page when asked for one': async (t) => {
        const page = await t.puter.events.list({ cursor: null, includeTotal: true });
        t.assert.ok(Array.isArray(page.items), 'a page carries items');
        t.assert.equal(typeof page.total, 'number', 'a total was requested');
    },

    'answers an id it does not hold the way it answers one that is gone': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.unsubscribe(''),
        );
        t.assert.equal(codeOf(error), 'subscription_does_not_exist');
    },

    'ends a persistent subscription through the handle it returns': async (t) => {
        const dir = await makeDir(t, 'events-off');

        const sub = await t.puter.events.onPersistent({ subject: `fs:${dir}` });
        t.assert.equal(typeof sub.off, 'function');
        await sub.off!();

        const after = await t.puter.events.list();
        t.assert.ok(
            ! after.some((row) => row.subId === sub.subId),
            'off() ends the subscription it was called on',
        );
    },

    'runs the handler here while this client is the one connected': async (t) => {
        const dir = await makeDir(t, 'events-durable');
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', RECORDING_HANDLER, {
            appUid,
        });
        // Enough to watch the folder, write into it, and run in the background.
        await t.puter.perms.grantApp(appUid, `fs:${dir}:write`);
        await t.puter.perms.grantApp(appUid, 'events:background');

        const before = recorded().length;
        await asApp(t, appUid, async () => {
            // A session subscription first: its answer is proof the connection
            // is up, and the persistent deliveries ride the same one. Without
            // it the write can land before the socket registers, and the
            // delivery goes looking for the app's events worker instead.
            const live = await open(t, `fs:${dir}`, () => {});
            if (! live) return;

            const sub = await t.puter.events.onPersistent({
                subject: `fs:${dir}`,
                delivery: 'single',
                handlerName: 'ingestUpload',
                handler: RECORDING_HANDLER,
                context: { label: 'ingest' },
            });
            try {
                await t.puter.fs.write(`${dir}/first.txt`, 'one');
                await waitFor(
                    () => recorded().length > before,
                    DELIVERY_TIMEOUT_MS,
                );
                const first = recorded()[before];
                t.assert.ok(first, 'the persistent handler ran in this client');
                t.assert.equal(first?.path, `${dir}/first.txt`);
                t.assert.equal(
                    first?.label,
                    'ingest',
                    'the handler is handed the context the subscription carries',
                );

                // A `single` hands out one delivery at a time, so a second one
                // arriving is the acknowledgement of the first.
                await t.puter.fs.write(`${dir}/second.txt`, 'two');
                const settled = await waitFor(
                    () => recorded().length > before + 1,
                    DELIVERY_TIMEOUT_MS,
                );
                t.assert.ok(
                    settled,
                    'the first delivery was acknowledged, so the next was handed over',
                );
            } finally {
                await sub.off!();
                await live.off();
            }
        });
    },

    'hands a broadcast persistent handler `user` and `fetch` too': async (t) => {
        const dir = await makeDir(t, 'events-broadcast-env');
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestBroadcastEnv', BROADCAST_ENV_HANDLER, {
            appUid,
        });
        await t.puter.perms.grantApp(appUid, `fs:${dir}:write`);
        await t.puter.perms.grantApp(appUid, 'events:background');

        const before = recordedBroadcastEnv().length;
        await asApp(t, appUid, async () => {
            const live = await open(t, `fs:${dir}`, () => {});
            if (! live) return;

            // Default delivery: `broadcast`, not `single` — nobody owes an
            // `ack`, but the environment is the same either way.
            const sub = await t.puter.events.onPersistent({
                subject: `fs:${dir}`,
                handlerName: 'ingestBroadcastEnv',
                handler: BROADCAST_ENV_HANDLER,
                context: { label: 'broadcast-env' },
            });
            try {
                await t.puter.fs.write(`${dir}/first.txt`, 'one');
                await waitFor(
                    () => recordedBroadcastEnv().length > before,
                    DELIVERY_TIMEOUT_MS,
                );
                const first = recordedBroadcastEnv()[before];
                t.assert.ok(first, 'the broadcast handler ran in this client');
                t.assert.equal(first?.hasUser, true, 'a broadcast handler is handed `user`');
                t.assert.equal(first?.hasFetch, true, 'a broadcast handler is handed `fetch`');
            } finally {
                await sub.off!();
                await live.off();
            }
        });
    },

    'takes background delivery only once the app is allowed it': async (t) => {
        const dir = await makeDir(t, 'events-consent');
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', RECORDING_HANDLER, {
            appUid,
        });
        await t.puter.perms.grantApp(appUid, `fs:${dir}:list`);

        const refused = await asApp(t, appUid, () =>
            t.assert.rejects(() =>
                t.puter.events.onPersistent({
                    subject: `fs:${dir}`,
                    delivery: 'single',
                    handlerName: 'ingestUpload',
                    handler: RECORDING_HANDLER,
                }),
            ),
        );
        t.assert.equal(codeOf(refused), 'events_background_consent_required');

        await t.puter.perms.grantApp(appUid, 'events:background');
        const subId = await asApp(t, appUid, async () => {
            const sub = await t.puter.events.onPersistent({
                subject: `fs:${dir}`,
                delivery: 'single',
                handlerName: 'ingestUpload',
                handler: RECORDING_HANDLER,
            });
            return sub.subId;
        });

        // Taking the consent back stops the subscription it allowed.
        await t.puter.perms.revokeApp(appUid, 'events:background');
        const settled = await waitFor(async () => {
            const held = await t.puter.events.list();
            return (
                held.find((row) => row.subId === subId)?.suspendedReason ===
                'permission_revoked'
            );
        }, DELIVERY_TIMEOUT_MS);
        t.assert.ok(settled, 'the subscription settled when consent was taken back');

        await t.puter.events.unsubscribe(subId);
    },

    'needs no consent for a subscription only this connection hears': async (t) => {
        const dir = await makeDir(t, 'events-no-consent');
        const appUid = await makeApp(t);
        await t.puter.perms.grantApp(appUid, `fs:${dir}:list`);

        await asApp(t, appUid, async () => {
            // Session subscriptions are socket-only by construction.
            const sub = await open(t, `fs:${dir}`, () => {});
            if (sub) await sub.off();

            // So is a durable one that asks for nothing else.
            const durable = await t.puter.events.onPersistent({
                subject: `fs:${dir}`,
                targets: ['socket'],
            });
            t.assert.deepEqual(durable.targets, ['socket']);
            await durable.off!();
        });
    },

    'refuses to bind an inline handler nothing is published for': async (t) => {
        const dir = await makeDir(t, 'events-unbound');
        const error = await t.assert.rejects(() =>
            t.puter.events.onPersistent({
                subject: `fs:${dir}`,
                handlerName: unique('missing'),
                handler: HANDLER,
            }),
        );
        t.assert.equal(codeOf(error), 'events_handler_not_found');
    },

    // -- Handlers ----------------------------------------------------

    'publishes, lists and removes a named handler': async (t) => {
        const appUid = await makeApp(t);

        const published = await t.puter.events.handlers.publish(
            'ingestUpload',
            HANDLER,
            { appUid },
        );
        t.assert.equal(published.name, 'ingestUpload');
        t.assert.equal(published.outcome, 'created');
        t.assert.ok(
            typeof published.hash === 'string' && published.hash.length === 64,
            'a publish reports the source hash',
        );

        const listed = await t.puter.events.handlers.list({ appUid });
        t.assert.deepEqual(
            listed.map((row) => row.name),
            ['ingestUpload'],
        );
        t.assert.equal(listed[0].subscriptions, 0);
        t.assert.ok(
            ! JSON.stringify(listed).includes('console.log'),
            'a listing never carries handler source',
        );

        const removed = await t.puter.events.handlers.remove('ingestUpload', {
            appUid,
        });
        t.assert.equal(removed.removed, true);
        t.assert.equal(removed.suspended, 0);
        t.assert.deepEqual(await t.puter.events.handlers.list({ appUid }), []);
    },

    'republishing the same source changes nothing': async (t) => {
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', HANDLER, { appUid });

        const again = await t.puter.events.handlers.publish(
            'ingestUpload',
            HANDLER,
            { appUid },
        );
        t.assert.equal(again.outcome, 'unchanged');
    },

    'updates a name it published, and takes one it means to replace': async (t) => {
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', HANDLER, { appUid });

        // Having published it, this client knows the base it is updating, so
        // the change is accepted rather than read as a racing build step.
        const updated = await t.puter.events.handlers.publish(
            'ingestUpload',
            OTHER_HANDLER,
            { appUid },
        );
        t.assert.equal(updated.outcome, 'updated');

        const replaced = await t.puter.events.handlers.publish(
            'ingestUpload',
            HANDLER,
            { appUid, replace: true },
        );
        t.assert.equal(replaced.outcome, 'updated');
        t.assert.equal(
            (await t.puter.events.handlers.list({ appUid }))[0].hash,
            replaced.hash,
            'the listing reports what the last publish left',
        );
    },

    'takes a whole set in one call': async (t) => {
        const appUid = await makeApp(t);

        const published = await t.puter.events.handlers.publishAll(
            [
                { name: 'ingestUpload', handler: HANDLER },
                { name: 'indexDocument', handler: OTHER_HANDLER },
            ],
            { appUid },
        );

        t.assert.deepEqual(
            published.map((row) => row.name),
            ['ingestUpload', 'indexDocument'],
        );
        t.assert.equal((await t.puter.events.handlers.list({ appUid })).length, 2);
    },

    // -- Events workers -----------------------------------------------

    'exposes the workers surface': async (t) => {
        for (const method of ['list', 'destroy'] as const) {
            t.assert.equal(
                typeof t.puter.events.workers[method],
                'function',
                `puter.events.workers.${method} is a function`,
            );
        }
    },

    'lists the events worker a first publish stood up, and destroys it': async (t) => {
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', HANDLER, { appUid });
        await t.puter.events.handlers.publish('indexDocument', OTHER_HANDLER, {
            appUid,
        });

        const page = await t.puter.events.workers.list();
        const worker = page.items.find((row) => row.appUid === appUid);
        t.assert.ok(worker, 'the app with published handlers is listed');
        t.assert.equal(worker?.handlerCount, 2);
        t.assert.equal(typeof worker?.script, 'string');
        t.assert.equal(typeof page.deployable, 'boolean');

        const destroyed = await t.puter.events.workers.destroy(appUid);
        t.assert.equal(destroyed.appUid, appUid);
        t.assert.equal(destroyed.removed, 2);

        const after = await t.puter.events.workers.list();
        t.assert.equal(
            after.items.find((row) => row.appUid === appUid),
            undefined,
            'destroying removes it from the listing',
        );
        t.assert.deepEqual(await t.puter.events.handlers.list({ appUid }), []);

        // Destroying dropped the publish bases this client had cached, so a
        // fresh publish reads as a create rather than as a lost race.
        const republished = await t.puter.events.handlers.publish(
            'ingestUpload',
            HANDLER,
            { appUid },
        );
        t.assert.equal(republished.name, 'ingestUpload');
    },

    'refuses to destroy an app with no published handlers': async (t) => {
        const appUid = await makeApp(t);
        const error = await t.assert.rejects(() =>
            t.puter.events.workers.destroy(appUid),
        );
        t.assert.equal(codeOf(error), 'events_handler_not_found');
    },

    'refuses an app token trying to list events workers': async (t) => {
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', HANDLER, { appUid });

        await asApp(t, appUid, async () => {
            const error = await t.assert.rejects(() => t.puter.events.workers.list());
            t.assert.equal(codeOf(error), 'events_worker_owner_only');
        });
    },

    'refuses to destroy an app the caller does not own': async (t) => {
        const appUid = await makeApp(t);
        await t.puter.events.handlers.publish('ingestUpload', HANDLER, { appUid });

        await asApp(t, appUid, async () => {
            // An app token names its own app; a second app's token would be
            // this account's own to make, so a foreign uid is what stands in
            // for "not owned" here.
            const error = await t.assert.rejects(() =>
                t.puter.events.workers.destroy(unique('not-owned')),
            );
            t.assert.equal(codeOf(error), 'events_handler_forbidden');
        });
    },

    // -- fetch ------------------------------------------------------
    //
    // Catching up is a query against the subject's own store, so these need no
    // connection at all — they run the same on a runtime with no WebSocket.

    'rejects a fetch with no subject before it calls anything': async (t) => {
        for (const subject of [undefined, '', '   ']) {
            const error = await t.assert.rejects(() =>
                t.puter.events.fetch({ subject } as { subject: string }),
            );
            t.assert.equal(codeOf(error), 'invalid_subject');
        }
    },

    'refuses a subject family with nothing stored behind it': async (t) => {
        for (const subject of ['fs:~/Documents', 'kv:cart']) {
            const error = await t.assert.rejects(() =>
                t.puter.events.fetch({ subject }),
            );
            t.assert.equal(codeOf(error), 'fetch_unsupported_subject');
        }
    },

    'refuses a notif subject naming an audience that is not one': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.fetch({ subject: 'notif:everyone' }),
        );
        t.assert.equal(codeOf(error), 'invalid_subject_audience');
    },

    'reads missed notifications back, oldest first': async (t) => {
        const title = unique('missed');
        await postNotification(t, title);

        const page = await t.puter.events.fetch({ subject: 'notif:account' });
        const mine = (await readAllNotifications(t)).find(
            (event) => (event.notification as { title?: string }).title === title,
        );

        t.assert.ok(mine, 'the notification just written comes back');
        t.assert.equal(mine!.op, 'post');
        t.assert.equal(mine!.audience, 'account');
        t.assert.equal(mine!.appUid, null);
        t.assert.equal(mine!.self, true);
        // The event id is the notification's own uid, which is what makes a
        // fetched copy and a delivered copy the same event.
        t.assert.equal(mine!.id, mine!.uid);
        t.assert.ok(typeof mine!.ts === 'number' && mine!.ts > 0);
        t.assert.ok(Array.isArray(page.items));
    },

    'pages from the cursor and returns only newer rows': async (t) => {
        const firstTitle = unique('page-one');
        const secondTitle = unique('page-two');
        await postNotification(t, firstTitle);
        await postNotification(t, secondTitle);

        const all = await readAllNotifications(t);
        const index = all.findIndex(
            (event) =>
                (event.notification as { title?: string }).title === firstTitle,
        );
        t.assert.ok(index >= 0, 'the first notification is in the mailbox');
        t.assert.ok(
            index + 1 <= 200,
            'the mailbox is inside one page, so a page can end on it',
        );

        // A page ending exactly on the first of the two, so its cursor sits
        // between them.
        const page = await t.puter.events.fetch({
            subject: 'notif:account',
            limit: index + 1,
        });
        t.assert.equal(page.items.length, index + 1);
        t.assert.ok(page.cursor, 'more to come, so a cursor comes back');

        const next = await t.puter.events.fetch({
            subject: 'notif:account',
            after: page.cursor,
        });
        const uids = new Set(next.items.map((event) => event.uid));
        t.assert.ok(
            !uids.has(all[index].uid),
            'the row the cursor was taken at is not repeated',
        );
        t.assert.equal(
            (next.items[0].notification as { title?: string }).title,
            secondTitle,
            'the page after the cursor starts at the next row',
        );
    },

    'refuses to publish into an app this account does not own': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.handlers.publish('ingestUpload', HANDLER, {
                appUid: 'app-00000000-0000-4000-8000-000000000099',
            }),
        );
        t.assert.equal(codeOf(error), 'events_handler_forbidden');
    },

    'refuses to publish without naming an app at all': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.events.handlers.publish('ingestUpload', HANDLER),
        );
        t.assert.equal(codeOf(error), 'events_handler_app_required');
    },
});
