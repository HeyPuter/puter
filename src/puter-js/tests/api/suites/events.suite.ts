import { suite, type TestContext } from '../harness/types.ts';

/**
 * `puter.events` rides a socket, and not every runtime the SDK ships to can
 * carry one — a worker isolate has no WebSocket client at all. So each test
 * that needs a delivery opens its subscription through `open()`, which either
 * hands back a live subscription or asserts the SDK's documented answer for a
 * runtime that cannot connect (`events_connection_failed`) and lets the test
 * end there. The decision is made from what the SDK actually did, not from
 * `t.platform`, so the same file covers whatever each runtime turns out to
 * support.
 */

/** Short enough that a runtime with no transport doesn't stall the suite. */
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

/**
 * Subscribe, or establish that this runtime cannot. Returns `null` after
 * asserting the no-transport contract, so callers can stop.
 */
const open = async (
    t: TestContext,
    subject: string,
    handler: (event: Delivered) => void,
): Promise<Subscription | null> => {
    try {
        return await t.puter.events.onLocal(
            subject,
            ({ event }) => handler(event as Delivered),
            { timeout: SUBSCRIBE_TIMEOUT_MS },
        );
    } catch (error) {
        t.assert.equal(
            codeOf(error),
            'events_connection_failed',
            `subscribe to ${subject} failed with an unexpected code: ${codeOf(error)}`,
        );
        t.assert.ok(
            typeof (error as Error).message === 'string' &&
                (error as Error).message.length > 0,
            'a connection failure carries a message',
        );
        return null;
    }
};

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

    'passes server error codes through unchanged': async (t) => {
        const dir = await makeDir(t, 'events-errors');
        const cases: Array<[string, string]> = [
            // An op the subject grammar does not define.
            [`fs:${dir}:frobnicate`, 'invalid_subject_op'],
            // A pattern past the compile-cost bounds (16 segments).
            [`fs:${dir}/${'deep/'.repeat(20)}x`, 'invalid_subject_pattern'],
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
            // On a runtime with no socket transport the SDK never gets far
            // enough to be told why — that answer is asserted too.
            if (codeOf(error) === 'events_connection_failed') continue;
            t.assert.equal(
                codeOf(error),
                expected,
                `${subject} answered ${codeOf(error)}`,
            );
        }
    },
});
