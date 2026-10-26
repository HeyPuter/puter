import { suite, type TestContext } from '../harness/types.ts';

// The SDK runs without an app here, so shares are of the app-less store. The
// shared instance switches users with `setAuthToken`; every switch is undone
// in a `finally`, since the browser platform shares it across tests.

const SUBSCRIBE_TIMEOUT_MS = 5000;
const DELIVERY_TIMEOUT_MS = 15000;

type Who = 'other' | 'admin';

type KvEvent = {
    key?: string;
    op?: string;
    self?: boolean;
    viaWorker?: boolean;
    value?: unknown;
};

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

/** A prefix of this test's own, ending in `:` as the server stores it. */
const unique = (label: string): string =>
    `kvshare-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}:`;

/** Run as another seeded user, then put the owner's session back. */
const as = async <T>(
    t: TestContext,
    who: Who,
    run: () => Promise<T>,
): Promise<T> => {
    t.puter.setAuthToken(t.env.users[who].token);
    try {
        return await run();
    } finally {
        t.puter.setAuthToken(t.env.users.user.token);
    }
};

/**
 * Run as the second user inside an app. `setAuthToken` adopts the app from the
 * token and never drops it, so the instance's app identity is put back too.
 */
const asOtherInApp = async <T>(
    t: TestContext,
    appUid: string,
    run: () => Promise<T>,
): Promise<T> => {
    const response = await fetch(`${t.env.apiOrigin}/auth/get-user-app-token`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${t.env.users.other.token}`,
        },
        body: JSON.stringify({ app_uid: appUid }),
    });
    const { token } = (await response.json()) as { token: string };
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

/** Share with the second user and hand back the handle. */
const shareWithOther = async (
    t: TestContext,
    prefix: string,
    access?: 'watch' | 'read' | 'write',
): Promise<string> => {
    const share = await t.puter.kv.share(
        prefix,
        t.env.users.other.username,
        access,
    );
    return share.handle;
};

/** A key-value write as the owner, outside the shared SDK instance. */
const ownerSet = async (t: TestContext, key: string, value: unknown) => {
    const res = await fetch(`${t.env.apiOrigin}/drivers/call`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${t.env.users.user.token}`,
            Origin: t.env.apiOrigin,
        },
        body: JSON.stringify({
            interface: 'puter-kvstore',
            method: 'set',
            args: { key, value },
        }),
    });
    if (res.status !== 200)
        throw new Error(`owner set failed with ${res.status}`);
};

export default suite('kvShare', {
    'share, use through the handle as the holder, change the level, and leave':
        async (t) => {
            const prefix = unique('flow');
            await t.puter.kv.set(`${prefix}meta`, { title: 'Groceries' });
            await t.puter.kv.set(`${prefix}item:1`, 'milk');

            const share = await t.puter.kv.share(
                prefix,
                t.env.users.other.username,
                'write',
            );
            t.assert.deepEqual(Object.keys(share).sort(), [
                'access',
                'appUid',
                'createdAt',
                'handle',
                'holder',
                'label',
                'prefix',
            ]);
            t.assert.equal(share.prefix, prefix);
            t.assert.equal(share.access, 'write');
            t.assert.equal(share.appUid, null);
            t.assert.equal(share.holder, t.env.users.other.username);
            const { handle } = share;

            await as(t, 'other', async () => {
                const { items } = await t.puter.kv.listShared({ limit: 200 });
                const held = items.find((one) => one.handle === handle);
                t.assert.ok(held, 'the holder lists the share');
                // The holder learns the grant, never the owner or the prefix.
                t.assert.deepEqual(Object.keys(held!).sort(), [
                    'access',
                    'appUid',
                    'createdAt',
                    'handle',
                    'label',
                ]);
                t.assert.equal(held!.access, 'write');

                t.assert.deepEqual(await t.puter.kv.get('meta', { handle }), {
                    title: 'Groceries',
                });
                t.assert.deepEqual(
                    await t.puter.kv.list('item:', true, { handle }),
                    [{ key: 'item:1', value: 'milk' }],
                );
                t.assert.equal(
                    await t.puter.kv.set('item:2', 'eggs', { handle }),
                    true,
                );
                t.assert.equal(
                    await t.puter.kv.incr('count', 1, { handle }),
                    1,
                );
                t.assert.equal(
                    await t.puter.kv.del('item:1', { handle }),
                    true,
                );
            });

            t.assert.equal(await t.puter.kv.get(`${prefix}item:2`), 'eggs');
            t.assert.equal(await t.puter.kv.get(`${prefix}count`), 1);
            t.assert.equal(await t.puter.kv.get(`${prefix}item:1`), null);

            const listed = await t.puter.kv.listSharedByMe({ limit: 200 });
            const row = listed.items.find((one) => one.handle === handle);
            t.assert.equal(row?.holder, t.env.users.other.username);
            t.assert.equal(row?.revokedAt, null);

            // Sharing the same prefix again changes the level in place.
            const lowered = await t.puter.kv.share(
                prefix,
                t.env.users.other.username,
                'read',
            );
            t.assert.equal(lowered.handle, handle);
            t.assert.equal(lowered.access, 'read');

            await as(t, 'other', async () => {
                t.assert.equal(
                    await t.puter.kv.get('item:2', { handle }),
                    'eggs',
                );
                const denied = await t.assert.rejects(() =>
                    t.puter.kv.set('item:3', 'bread', { handle }),
                );
                t.assert.equal(codeOf(denied), 'kv_handle_access_denied');

                const left = await t.puter.kv.unshare(handle);
                t.assert.equal(left.handle, handle);
                t.assert.equal(typeof left.revokedAt, 'number');

                const gone = await t.assert.rejects(() =>
                    t.puter.kv.get('item:2', { handle }),
                );
                t.assert.equal(codeOf(gone), 'kv_handle_not_found');
            });

            const after = await t.puter.kv.listSharedByMe({ limit: 200 });
            const retired = after.items.find((one) => one.handle === handle);
            t.assert.equal(retired?.revokedBy, 'holder');
            t.assert.equal(typeof retired?.revokedAt, 'number');
        },

    "the owner unsharing ends the holder's access": async (t) => {
        const prefix = unique('revoke');
        await t.puter.kv.set(`${prefix}note`, 'hi');
        const handle = await shareWithOther(t, prefix);

        await as(t, 'other', async () => {
            const { items } = await t.puter.kv.listShared({ limit: 200 });
            t.assert.equal(
                items.find((one) => one.handle === handle)?.access,
                'read',
            );
        });

        const revoked = await t.puter.kv.unshare(handle);
        t.assert.equal(revoked.handle, handle);
        t.assert.equal(typeof revoked.revokedAt, 'number');

        const listed = await t.puter.kv.listSharedByMe({ limit: 200 });
        t.assert.equal(
            listed.items.find((one) => one.handle === handle)?.revokedBy,
            'owner',
        );

        await as(t, 'other', async () => {
            const { items } = await t.puter.kv.listShared({ limit: 200 });
            t.assert.ok(
                !items.some((one) => one.handle === handle),
                'a revoked share is not listed',
            );
            const gone = await t.assert.rejects(() =>
                t.puter.kv.get('note', { handle }),
            );
            t.assert.equal(codeOf(gone), 'kv_handle_not_found');
        });
    },

    'sharing again changes the level in place, and the holder can leave':
        async (t) => {
            const prefix = unique('level');
            const first = await t.puter.kv.share(
                prefix,
                t.env.users.other.username,
                'watch',
            );
            const raised = await t.puter.kv.share(
                prefix,
                t.env.users.other.username,
                'write',
            );
            t.assert.equal(raised.handle, first.handle);
            t.assert.equal(raised.access, 'write');
            t.assert.equal(raised.createdAt, first.createdAt);

            await as(t, 'other', async () => {
                const { items } = await t.puter.kv.listShared({ limit: 200 });
                t.assert.equal(
                    items.find((one) => one.handle === first.handle)?.access,
                    'write',
                );

                const left = await t.puter.kv.unshare(first.handle);
                t.assert.equal(left.handle, first.handle);
                const after = await t.puter.kv.listShared({ limit: 200 });
                t.assert.ok(
                    !after.items.some((one) => one.handle === first.handle),
                    'a share you left is not listed',
                );
                // Leaving twice answers the same way.
                t.assert.equal(
                    (await t.puter.kv.unshare(first.handle)).handle,
                    first.handle,
                );
            });

            const listed = await t.puter.kv.listSharedByMe({ limit: 200 });
            const row = listed.items.find((one) => one.handle === first.handle);
            t.assert.equal(row?.access, 'write');
            t.assert.equal(row?.revokedBy, 'holder');
        },

    'share takes an options object, defaults to read, and sets the label':
        async (t) => {
            const otherUuid = await as(
                t,
                'other',
                async () => (await t.puter.auth.getUser()).uuid,
            );
            const prefix = unique('options');
            const share = await t.puter.kv.share({
                prefix,
                recipient: { uid: otherUuid },
                label: 'Japan 2027',
            });
            t.assert.equal(share.access, 'read');
            t.assert.equal(share.label, 'Japan 2027');
            t.assert.equal(share.holder, t.env.users.other.username);

            await as(t, 'other', async () => {
                const { items } = await t.puter.kv.listShared({ limit: 200 });
                t.assert.equal(
                    items.find((one) => one.handle === share.handle)?.label,
                    'Japan 2027',
                );
            });

            // Omitting the label keeps it, and `null` clears it.
            const kept = await t.puter.kv.share(
                prefix,
                { username: t.env.users.other.username },
                'read',
            );
            t.assert.equal(kept.label, 'Japan 2027');
            const cleared = await t.puter.kv.share({
                prefix,
                recipient: t.env.users.other.username,
                label: null,
            });
            t.assert.equal(cleared.handle, share.handle);
            t.assert.equal(cleared.label, null);

            await t.puter.kv.unshare(share.handle);
        },

    'share refuses bad input with the documented codes': async (t) => {
        const address = await t.assert.rejects(() =>
            t.puter.kv.share(unique('email'), 'someone@example.com'),
        );
        t.assert.equal(codeOf(address), 'invalid_recipient');

        const self = await t.assert.rejects(() =>
            t.puter.kv.share(unique('self'), t.env.users.user.username),
        );
        t.assert.equal(codeOf(self), 'bad_request');

        const nobody = await t.assert.rejects(() =>
            t.puter.kv.share(unique('nobody'), 'no-such-user-kvshare'),
        );
        t.assert.equal(codeOf(nobody), 'subject_does_not_exist');

        const label = await t.assert.rejects(() =>
            t.puter.kv.share({
                prefix: unique('label'),
                recipient: t.env.users.other.username,
                label: 'two\nlines',
            }),
        );
        t.assert.equal(codeOf(label), 'kv_share_label_invalid');

        const level = await t.assert.rejects(() =>
            t.puter.kv.share(
                unique('level'),
                t.env.users.other.username,
                'admin' as never,
            ),
        );
        t.assert.equal(codeOf(level), 'kv_share_access_invalid');

        const pattern = await t.assert.rejects(() =>
            t.puter.kv.share('notes:*', t.env.users.other.username),
        );
        t.assert.equal(codeOf(pattern), 'invalid_kv_share_prefix');
    },

    "sharing an app's data notifies the holder inside that app": async (t) => {
        const name = `kvshare-app-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const app = await t.puter.apps.create(
            name,
            `https://example.com/${name}`,
        );
        const appUid = (app as unknown as { uid: string }).uid;
        const prefix = unique('app');
        await t.puter.kv.set(`${prefix}note`, 'in the app', {
            appUuid: appUid,
        });

        const share = await t.puter.kv.share({
            prefix,
            recipient: t.env.users.other.username,
            label: 'From the app',
            appUuid: appUid,
        });
        t.assert.equal(share.appUid, appUid);

        try {
            await asOtherInApp(t, appUid, async () => {
                const page = await t.puter.events.fetch({
                    subject: 'notif:app-user',
                    limit: 200,
                });
                const received = page.items.find(
                    (event) =>
                        event.type === 'kv.share.received' &&
                        (event.notification as { handle?: string }).handle ===
                            share.handle,
                );
                t.assert.ok(received, 'the holder is told inside the app');
                t.assert.deepEqual(received!.notification, {
                    type: 'kv.share.received',
                    handle: share.handle,
                    access: 'read',
                    label: 'From the app',
                    createdAt: share.createdAt,
                });

                const { items } = await t.puter.kv.listShared({ limit: 200 });
                t.assert.ok(
                    items.some((one) => one.handle === share.handle),
                    'the app lists the share of its own data',
                );
                t.assert.ok(
                    items.every((one) => one.appUid === appUid),
                    'an app lists only the shares of its own data',
                );
                t.assert.equal(
                    await t.puter.kv.get('note', { handle: share.handle }),
                    'in the app',
                );
            });
        } finally {
            await t.puter.kv.unshare(share.handle);
        }
    },

    'listings page with a cursor and report a total': async (t) => {
        const handles: string[] = [];
        for (const label of ['page-a', 'page-b', 'page-c']) {
            handles.push(await shareWithOther(t, unique(label), 'watch'));
        }
        try {
            const first = await t.puter.kv.listSharedByMe({
                limit: 1,
                includeTotal: true,
            });
            t.assert.equal(first.items.length, 1);
            t.assert.ok(
                typeof first.total === 'number' && first.total >= 3,
                `total was ${first.total}`,
            );
            t.assert.ok(first.cursor, 'a cursor while more pages remain');
            const second = await t.puter.kv.listSharedByMe({
                limit: 1,
                cursor: first.cursor,
            });
            t.assert.ok(
                second.items[0]?.handle !== first.items[0]?.handle,
                'the cursor moves on',
            );
            t.assert.equal(second.total, undefined);

            await as(t, 'other', async () => {
                const seen: string[] = [];
                let cursor: string | undefined;
                do {
                    const page = await t.puter.kv.listShared({
                        limit: 2,
                        cursor,
                    });
                    seen.push(...page.items.map((one) => one.handle));
                    cursor = page.cursor;
                } while (cursor);
                for (const handle of handles) {
                    t.assert.ok(
                        seen.includes(handle),
                        `paging reached ${handle}`,
                    );
                }
            });
        } finally {
            for (const handle of handles) await t.puter.kv.unshare(handle);
        }
    },

    'every list form carries the handle': async (t) => {
        const prefix = unique('list');
        await t.puter.kv.set([
            { key: `${prefix}m:01`, value: 1 },
            { key: `${prefix}m:02`, value: 2 },
            { key: `${prefix}m:03`, value: 3 },
            { key: `${prefix}m:04`, value: 4 },
            { key: `${prefix}m:05`, value: 5 },
            { key: `${prefix}other`, value: 0 },
        ]);
        const handle = await shareWithOther(t, prefix, 'read');
        const all = ['m:01', 'm:02', 'm:03', 'm:04', 'm:05'];

        try {
            await as(t, 'other', async () => {
                t.assert.deepEqual(
                    await t.puter.kv.list('m:*', { handle }),
                    all,
                );
                t.assert.deepEqual(
                    await t.puter.kv.list('m:', true, { handle }),
                    all.map((key, i) => ({ key, value: i + 1 })),
                );
                t.assert.deepEqual(
                    (
                        (await t.puter.kv.list(true, { handle })) as Array<{
                            key: string;
                        }>
                    ).map((one) => one.key),
                    [...all, 'other'],
                );
                // The legacy form, where the options object is also the optConfig.
                t.assert.deepEqual(
                    await t.puter.kv.list({ pattern: 'm:*', handle } as never),
                    all,
                );

                // Pages, following the cursor, in both directions.
                for (const reverse of [false, true]) {
                    const keys: string[] = [];
                    let cursor: string | undefined;
                    let pages = 0;
                    do {
                        const page = await t.puter.kv.list({
                            pattern: 'm:*',
                            limit: 2,
                            reverse,
                            ...(cursor ? { cursor } : {}),
                            optConfig: { handle },
                        });
                        keys.push(...page.items);
                        cursor = page.cursor;
                        pages++;
                    } while (cursor && pages < 10);
                    t.assert.deepEqual(
                        keys,
                        reverse ? [...all].reverse() : all,
                    );
                }

                const counted = await t.puter.kv.list({
                    pattern: 'm:*',
                    limit: 2,
                    returnValues: true,
                    includeTotal: true,
                    optConfig: { handle },
                });
                t.assert.equal(counted.total, 5);
                t.assert.deepEqual(counted.items, [
                    { key: 'm:01', value: 1 },
                    { key: 'm:02', value: 2 },
                ]);

                const skipped = await t.puter.kv.list({
                    pattern: 'm:*',
                    limit: 2,
                    offset: 2,
                    optConfig: { handle },
                });
                t.assert.deepEqual(skipped.items, ['m:03', 'm:04']);

                const streamed: string[] = [];
                for await (const page of t.puter.kv.list({
                    pattern: 'm:*',
                    limit: 2,
                    stream: true,
                    optConfig: { handle },
                })) {
                    streamed.push(...page.items);
                }
                t.assert.deepEqual(streamed, all);
            });
        } finally {
            await t.puter.kv.unshare(handle);
        }
    },

    'a handle answers only its holder, at its level': async (t) => {
        const prefix = unique('bound');
        await t.puter.kv.set(`${prefix}note`, 'hi');
        const watch = await shareWithOther(t, prefix, 'watch');

        try {
            await as(t, 'other', async () => {
                const below = await t.assert.rejects(() =>
                    t.puter.kv.get('note', { handle: watch }),
                );
                t.assert.equal(codeOf(below), 'kv_handle_access_denied');
                const flush = await t.assert.rejects(() =>
                    t.puter.kv.flush({ handle: watch }),
                );
                t.assert.equal(codeOf(flush), 'kv_handle_option_invalid');
                const mixed = await t.assert.rejects(() =>
                    t.puter.kv.get('note', { handle: watch, appUuid: 'app-x' }),
                );
                t.assert.equal(codeOf(mixed), 'kv_handle_option_invalid');
            });
            await as(t, 'admin', async () => {
                const stranger = await t.assert.rejects(() =>
                    t.puter.kv.get('note', { handle: watch }),
                );
                t.assert.equal(codeOf(stranger), 'kv_handle_not_found');
            });
        } finally {
            await t.puter.kv.unshare(watch);
        }
    },

    'only the owner and the holder can unshare': async (t) => {
        const handle = await shareWithOther(t, unique('stranger'), 'watch');
        try {
            await as(t, 'admin', async () => {
                // Unsharing keeps the code the older handle routes answer with.
                const unknown = await t.assert.rejects(() =>
                    t.puter.kv.unshare(handle),
                );
                t.assert.equal(codeOf(unknown), 'subject_does_not_exist');
                const { items } = await t.puter.kv.listShared({ limit: 200 });
                t.assert.ok(
                    !items.some((one) => one.handle === handle),
                    'a stranger does not list it',
                );
            });
        } finally {
            await t.puter.kv.unshare(handle);
        }
        // Stopping a share that already stopped answers the same way again.
        const again = await t.puter.kv.unshare(handle);
        t.assert.equal(again.handle, handle);
    },

    'onlyIfAbsent writes once and then resolves to false': async (t) => {
        const key = `${unique('absent')}room`;
        t.assert.equal(
            await t.puter.kv.set(key, 'first', { onlyIfAbsent: true }),
            true,
        );
        t.assert.equal(
            await t.puter.kv.set(key, 'second', { onlyIfAbsent: true }),
            false,
        );
        t.assert.equal(
            await t.puter.kv.set({
                key,
                value: 'third',
                optConfig: { onlyIfAbsent: true },
            }),
            false,
        );
        t.assert.equal(await t.puter.kv.get(key), 'first');

        const batch = await t.assert.rejects(() =>
            t.puter.kv.set([{ key: `${key}-b`, value: 1 }], {
                onlyIfAbsent: true,
            }),
        );
        t.assert.equal(codeOf(batch), 'invalid_request');
    },

    'onlyIfAbsent through a write handle': async (t) => {
        const prefix = unique('absent-handle');
        await t.puter.kv.set(`${prefix}taken`, 'owner');
        const handle = await shareWithOther(t, prefix, 'write');
        try {
            await as(t, 'other', async () => {
                t.assert.equal(
                    await t.puter.kv.set('taken', 'holder', {
                        handle,
                        onlyIfAbsent: true,
                    }),
                    false,
                );
                t.assert.equal(
                    await t.puter.kv.set('free', 'holder', {
                        handle,
                        onlyIfAbsent: true,
                    }),
                    true,
                );
            });
            t.assert.equal(await t.puter.kv.get(`${prefix}taken`), 'owner');
            t.assert.equal(await t.puter.kv.get(`${prefix}free`), 'holder');
        } finally {
            await t.puter.kv.unshare(handle);
        }
    },

    'the holder watches through the handle and tells its own writes apart':
        async (t) => {
            const prefix = unique('events');
            const handle = await shareWithOther(t, prefix, 'write');
            const seen: KvEvent[] = [];

            try {
                await as(t, 'other', async () => {
                    const sub = await t.puter.events.onLocal(
                        `kv:${handle}:item:*`,
                        ({ event }) => {
                            seen.push(event as KvEvent);
                        },
                        { timeout: SUBSCRIBE_TIMEOUT_MS, includeValue: true },
                    );
                    try {
                        await ownerSet(t, `${prefix}item:owner`, 'from owner');
                        t.assert.ok(
                            await waitFor(
                                () =>
                                    seen.some(
                                        (one) => one.key === 'item:owner',
                                    ),
                                DELIVERY_TIMEOUT_MS,
                            ),
                            "the owner's write reaches the holder",
                        );
                        await t.puter.kv.set('item:holder', 'from holder', {
                            handle,
                        });
                        t.assert.ok(
                            await waitFor(
                                () =>
                                    seen.some(
                                        (one) => one.key === 'item:holder',
                                    ),
                                DELIVERY_TIMEOUT_MS,
                            ),
                            "the holder's own write reaches the holder",
                        );
                    } finally {
                        await sub.off();
                    }
                });

                const fromOwner = seen.find((one) => one.key === 'item:owner');
                t.assert.equal(fromOwner?.value, 'from owner');
                t.assert.equal(fromOwner?.self, false);
                t.assert.equal(fromOwner?.viaWorker, false);
                const fromHolder = seen.find(
                    (one) => one.key === 'item:holder',
                );
                t.assert.equal(fromHolder?.self, true);
                t.assert.equal(fromHolder?.viaWorker, false);
            } finally {
                await t.puter.kv.unshare(handle);
            }
        },
});
