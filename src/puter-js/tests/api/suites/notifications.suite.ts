import { suite, type TestContext } from '../harness/types.ts';

const DELIVERY_TIMEOUT_MS = 15000;

type Received = Parameters<
    Parameters<TestContext['puter']['notifications']['onNotification']>[0]
>[0];

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

/** An app of this account's own, so it can hold an app token for it. */
const makeApp = async (t: TestContext): Promise<string> => {
    const name = unique('notif');
    const app = await t.puter.apps.create(name, `https://example.com/${name}`);
    return (app as unknown as { uid: string }).uid;
};

const appToken = async (t: TestContext, appUid: string): Promise<string> => {
    const response = await fetch(`${t.env.apiOrigin}/auth/get-user-app-token`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${t.env.users.user.token}`,
        },
        body: JSON.stringify({ app_uid: appUid }),
    });
    const { token } = (await response.json()) as { token: string };
    return token;
};

/** Run as the app rather than as the account, then put the session back. */
const asApp = async <T>(
    t: TestContext,
    appUid: string,
    run: () => Promise<T>,
): Promise<T> => {
    const token = await appToken(t, appUid);
    // setAuthToken keeps the app identity, so it is put back afterwards.
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

export default suite('notifications', {
    'puter.notifications is registered': async (t) => {
        t.assert.ok(t.puter.notifications, 'puter.notifications is registered');
        for (const method of [
            'notify',
            'onNotification',
            'on',
            'off',
            'requestPermission',
            'hasPermission',
            'registerDevice',
            'listDevices',
            'removeDevice',
        ] as const) {
            t.assert.equal(
                typeof t.puter.notifications[method],
                'function',
                method,
            );
        }
    },

    'an app notifies its user and reads it back': async (t) => {
        const appUid = await makeApp(t);
        await asApp(t, appUid, async () => {
            const title = unique('caught-up');
            const uid = await t.puter.notifications.notify({
                title,
                text: 'From the suite',
                target: '/items/1',
                data: { id: 1 },
                channel: 'messages',
            });
            t.assert.equal(typeof uid, 'string');

            const seen: Received[] = [];
            const listener = await t.puter.notifications.onNotification((n) => {
                seen.push(n);
            });
            try {
                const caught = seen.find((n) => n.uid === uid);
                t.assert.ok(caught, 'the existing notification was caught up');
                t.assert.equal(caught?.title, title);
                t.assert.equal(caught?.text, 'From the suite');
                t.assert.equal(caught?.target, '/items/1');
                t.assert.deepEqual(caught?.data, { id: 1 });
                t.assert.equal(caught?.channel, 'messages');
                t.assert.equal(caught?.app?.uid, appUid);
                t.assert.equal(typeof caught?.createdAt, 'number');

                const liveUid = await t.puter.notifications.notify({
                    title: unique('live'),
                });
                const arrived = await waitFor(
                    () => seen.some((n) => n.uid === liveUid),
                    DELIVERY_TIMEOUT_MS,
                );
                t.assert.ok(arrived, 'a new notification arrived live');
                t.assert.equal(
                    seen.filter((n) => n.uid === liveUid).length,
                    1,
                    'it was handed over once',
                );
            } finally {
                await listener.off();
            }
        });
    },

    "an app reads only its own app's notifications": async (t) => {
        const other = await makeApp(t);
        const otherUid = await asApp(t, other, () =>
            t.puter.notifications.notify({ title: unique('other') }),
        );

        const appUid = await makeApp(t);
        await asApp(t, appUid, async () => {
            const ownUid = await t.puter.notifications.notify({
                title: unique('own'),
            });
            const seen: string[] = [];
            const listener = await t.puter.notifications.onNotification((n) => {
                seen.push(n.uid);
            });
            await listener.off();

            t.assert.ok(seen.includes(ownUid), 'its own notification is read');
            t.assert.ok(!seen.includes(otherUid), "another app's is not");
        });
    },

    'catchUp: false skips what the app already has': async (t) => {
        const appUid = await makeApp(t);
        await asApp(t, appUid, async () => {
            const before = await t.puter.notifications.notify({
                title: unique('before'),
            });
            const seen: string[] = [];
            const listener = await t.puter.notifications.onNotification(
                (n) => {
                    seen.push(n.uid);
                },
                { catchUp: false },
            );
            try {
                const after = await t.puter.notifications.notify({
                    title: unique('after'),
                });
                const arrived = await waitFor(
                    () => seen.includes(after),
                    DELIVERY_TIMEOUT_MS,
                );
                t.assert.ok(arrived, 'the new one arrived');
                t.assert.ok(!seen.includes(before), 'the old one was skipped');
            } finally {
                await listener.off();
            }
        });
    },

    'notify from an account session is refused': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.notifications.notify({ title: 'Not an app' }),
        );
        t.assert.equal(codeOf(error), 'forbidden');
        t.assert.ok(error instanceof Error, 'a PuterJSError');
    },

    'onNotification from an account session is refused': async (t) => {
        const error = await t.assert.rejects(() =>
            t.puter.notifications.onNotification(() => {}),
        );
        t.assert.equal(codeOf(error), 'app_required');
    },

    'notify passes a bad field back as bad_request': async (t) => {
        const appUid = await makeApp(t);
        await asApp(t, appUid, async () => {
            const error = await t.assert.rejects(() =>
                t.puter.notifications.notify({
                    title: 'Bad target',
                    target: 'https://example.com',
                }),
            );
            t.assert.equal(codeOf(error), 'bad_request');
            t.assert.ok(
                String((error as Error).message).includes('target'),
                'the message names the field',
            );
        });
    },

    'hasPermission is false for an app until the user grants it': async (t) => {
        const appUid = await makeApp(t);
        t.assert.equal(
            await asApp(t, appUid, () => t.puter.notifications.hasPermission()),
            false,
        );

        await t.puter.perms.grantApp(appUid, 'notifications:push');
        t.assert.equal(
            await asApp(t, appUid, () => t.puter.notifications.hasPermission()),
            true,
        );
    },

    'devices: register, list and remove from a user session': async (t) => {
        const token = unique('device-token');
        const device = await t.puter.notifications.registerDevice({
            platform: 'web',
            token,
            label: 'Suite browser',
        });
        t.assert.equal(device.platform, 'web');
        t.assert.equal(device.label, 'Suite browser');
        t.assert.equal(device.current, true);
        t.assert.equal(typeof device.createdAt, 'number');
        t.assert.ok(!('token' in device), 'the token is never returned');

        const listed = await t.puter.notifications.listDevices();
        t.assert.ok(
            listed.some((d) => d.uid === device.uid),
            'the device is listed',
        );

        await t.puter.notifications.removeDevice(device.uid);
        const after = await t.puter.notifications.listDevices();
        t.assert.ok(
            !after.some((d) => d.uid === device.uid),
            'the device is gone',
        );

        const error = await t.assert.rejects(() =>
            t.puter.notifications.removeDevice(device.uid),
        );
        t.assert.equal(codeOf(error), 'not_found');
    },

    'devices: an app token is refused': async (t) => {
        const appUid = await makeApp(t);
        await asApp(t, appUid, async () => {
            const listed = await t.assert.rejects(() =>
                t.puter.notifications.listDevices(),
            );
            t.assert.equal(codeOf(listed), 'forbidden');

            const registered = await t.assert.rejects(() =>
                t.puter.notifications.registerDevice({
                    platform: 'web',
                    token: unique('app-token'),
                }),
            );
            t.assert.equal(codeOf(registered), 'forbidden');
        });
    },
});
