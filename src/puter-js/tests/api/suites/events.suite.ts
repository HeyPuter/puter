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
    condition: () => boolean,
    timeoutMs: number,
): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (condition()) return true;
        await sleep(50);
    }
    return condition();
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

export default suite('events', {
    'exposes onLocal': async (t) => {
        t.assert.ok(t.puter.events, 'puter.events is registered');
        t.assert.equal(typeof t.puter.events.onLocal, 'function');
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
});
