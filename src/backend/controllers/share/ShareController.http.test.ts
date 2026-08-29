/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { runWithContext } from '../../core/context.js';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
} from '../../testUtil.js';
import { ShareController } from './ShareController.js';

/**
 * Route-level coverage for the sharing endpoints. The service unit tests drive
 * the semantics; this suite exists to catch a route that was never registered,
 * a gate that rejects a legitimate request, and anything the response shape
 * leaks.
 */
describe('share endpoints over HTTP', () => {
    let env: PuterTestEnv;

    beforeAll(async () => {
        env = await setupPuterTestEnv();
    }, 120_000);

    afterAll(async () => {
        await env?.shutdown();
    });

    const post = (path: string, token: string, body: unknown) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });

    const get = (path: string, token: string, params: Record<string, string>) => {
        const url = new URL(path, env.apiOrigin);
        for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
        return fetch(url, { headers: { authorization: `Bearer ${token}` } });
    };

    const del = (path: string, token: string) =>
        fetch(new URL(path, env.apiOrigin), {
            method: 'DELETE',
            headers: { authorization: `Bearer ${token}` },
        });

    /** Fresh accounts: the seeded ones accumulate shares across this file. */
    const makeUser = async () => {
        const username = `sbm${Math.random().toString(36).slice(2, 9)}`;
        return createTestUser(env.server, {
            username,
            password: 'puter-test-user-password',
        });
    };

    /** A file in the owner's home. Written directly — these tests are about
     *  the share routes, not the upload path. */
    const makeFile = async (owner: { username: string }) => {
        const uid = crypto.randomUUID();
        const name = `share-http-${uid.slice(0, 8)}.txt`;
        const path = `/${owner.username}/${name}`;
        const user = await env.server.stores.user.getByUsername(owner.username);
        await env.server.clients.db.write(
            'INSERT INTO `fsentries` (`uuid`, `name`, `path`, `user_id`, `is_dir`, `modified`) VALUES (?, ?, ?, ?, 0, ?)',
            [uid, name, path, user!.id, Math.floor(Date.now() / 1000)],
        );
        return { uid, path, name };
    };

    // Masking hides where an item sits, not who may open it.
    it('will not let a masked path reach an unshared sibling', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const shared = await makeFile(owner);
        const secret = await makeFile(owner);

        await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: shared.uid }],
            mode: 'read',
        });

        const read = (path: string) =>
            fetch(
                `${env.apiOrigin}/read?${new URLSearchParams({ file: path })}`,
                {
                    headers: {
                        authorization: `Bearer ${recipient.token}`,
                        origin: env.apiOrigin,
                    },
                },
            );

        const masked = `/${owner.username}/${shared.uid}/${shared.name}`;
        expect((await read(masked)).status).toBe(200);

        for (const attempt of [
            // The shared item's root, renamed to the sibling.
            `/${owner.username}/${shared.uid}/${secret.name}`,
            // The sibling's own uuid, as if it had leaked.
            `/${owner.username}/${secret.uid}/${secret.name}`,
            // Back out of the root the uuid vouched for.
            `/${owner.username}/${shared.uid}/${shared.name}/../${secret.name}`,
            // The owner's real path, named outright.
            secret.path,
        ]) {
            const res = await read(attempt);
            expect(res.status, `reachable: ${attempt}`).not.toBe(200);
        }
    });

    it('says whether a share created access or the recipient already had it', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);
        const share = (mode: string) =>
            post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: file.uid }],
                mode,
            }).then((r) => r.json() as Promise<{
                results: Array<{ is_new?: boolean }>;
            }>);

        expect((await share('read')).results[0].is_new).toBe(true);
        // Without this the dialog cannot tell a repeat from a first share.
        expect((await share('read')).results[0].is_new).toBe(false);
        expect((await share('write')).results[0].is_new).toBe(false);

        // A listing describes standing access, so it says nothing about it.
        const listed = await get('/share/shares', owner.token, {
            uid: file.uid,
        }).then((r) => r.json() as Promise<{
            items: Array<Record<string, unknown>>;
        }>);
        expect(listed.items[0]).not.toHaveProperty('is_new');
    });

    it('shares an item, lists it for the recipient, then revokes it', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);

        const shareRes = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(shareRes.status).toBe(200);
        const shareBody = (await shareRes.json()) as {
            status: string;
            results: Array<{ status: string; mode?: string; name?: string }>;
        };
        expect(shareBody.status).toBe('success');
        expect(shareBody.results[0].mode).toBe('read');
        expect(shareBody.results[0].name).toBe(file.name);

        const listRes = await get(
            '/share/shared-with-me',
            recipient.token,
            { includeTotal: 'true' },
        );
        expect(listRes.status).toBe(200);
        const listed = (await listRes.json()) as {
            items: Array<Record<string, unknown>>;
            total?: number;
        };
        const row = listed.items.find((i) => i.uid_entry === file.uid);
        expect(row).toBeDefined();
        expect(row?.issuer).toBe(owner.username);
        expect(row?.mode).toBe('read');
        expect(typeof listed.total).toBe('number');

        // Nothing internal rides along in the response.
        for (const key of ['issuer_user_id', 'holder_user_id', 'fsentry_id']) {
            expect(row).not.toHaveProperty(key);
        }

        const revokeRes = await post('/share/revoke', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
        });
        expect(revokeRes.status).toBe(200);
        expect(await revokeRes.json()).toMatchObject({ revoked: 1 });

        const afterRes = await get('/share/shared-with-me', recipient.token, {});
        const after = (await afterRes.json()) as {
            items: Array<Record<string, unknown>>;
        };
        expect(after.items.find((i) => i.uid_entry === file.uid)).toBeUndefined();
    });

    describe('GET /share/shared-by-me', () => {
        it('lists what the caller shared out, across unrelated items', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const stranger = await makeUser();
            const files = [await makeFile(owner), await makeFile(owner)];

            for (const file of files) {
                const res = await post('/share', owner.token, {
                    recipients: [recipient.username],
                    items: [{ uid: file.uid }],
                    mode: 'read',
                });
                expect(res.status).toBe(200);
            }
            await post('/share', stranger.token, {
                recipients: [recipient.username],
                items: [{ uid: (await makeFile(stranger)).uid }],
                mode: 'read',
            });

            const res = await get('/share/shared-by-me', owner.token, {
                includeTotal: 'true',
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                items: Array<Record<string, unknown>>;
                total?: number;
            };

            expect(body.items.map((i) => i.uid_entry).sort()).toEqual(
                files.map((f) => f.uid).sort(),
            );
            expect(body.total).toBe(files.length);
            for (const item of body.items) {
                expect(item.holder).toBe(recipient.username);
                expect(item.issuer).toBe(owner.username);
                expect(item.issued_by_app).toBeNull();
                for (const key of [
                    'issuer_user_id',
                    'holder_user_id',
                    'fsentry_id',
                    'recipient_email',
                ]) {
                    expect(item).not.toHaveProperty(key);
                }
            }

            // Another account's shares are not the caller's business, whoever
            // they went to.
            const strangersView = (await (
                await get('/share/shared-by-me', stranger.token, {})
            ).json()) as { items: Array<Record<string, unknown>> };
            for (const file of files) {
                expect(
                    strangersView.items.find((i) => i.uid_entry === file.uid),
                ).toBeUndefined();
            }
        });

        it('pages with a cursor and stops when there is none', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const files = [
                await makeFile(owner),
                await makeFile(owner),
                await makeFile(owner),
            ];
            for (const file of files) {
                await post('/share', owner.token, {
                    recipients: [recipient.username],
                    items: [{ uid: file.uid }],
                    mode: 'read',
                });
            }

            const seen: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < 5; page++) {
                const params: Record<string, string> = { limit: '1' };
                if (cursor) params.cursor = cursor;
                const body = (await (
                    await get('/share/shared-by-me', owner.token, params)
                ).json()) as {
                    items: Array<{ uid_entry: string }>;
                    cursor?: string;
                };
                seen.push(...body.items.map((i) => i.uid_entry));
                cursor = body.cursor;
                if (!cursor) break;
            }

            expect(cursor).toBeUndefined();
            expect(seen.sort()).toEqual(files.map((f) => f.uid).sort());
        });

        it('does not leak another user\'s rows when their cursor is replayed', async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const attacker = await makeUser();
            const files = [await makeFile(owner), await makeFile(owner)];
            for (const file of files) {
                await post('/share', owner.token, {
                    recipients: [recipient.username],
                    items: [{ uid: file.uid }],
                    mode: 'read',
                });
            }

            // A cursor minted while the owner pages their own listing.
            const first = (await (
                await get('/share/shared-by-me', owner.token, { limit: '1' })
            ).json()) as { items: Array<{ uid_entry: string }>; cursor?: string };
            expect(first.cursor).toBeDefined();

            // The attacker has shared nothing. Replaying the owner's cursor as
            // themselves must still bind to the attacker's own rows, not the
            // owner's — the query scopes on the caller's id, and the cursor is
            // only a resume position within that scope.
            const replayed = (await (
                await get('/share/shared-by-me', attacker.token, {
                    cursor: first.cursor!,
                })
            ).json()) as { items: Array<{ uid_entry: string }> };

            expect(replayed.items).toEqual([]);
        });

        // A caller who believes they filtered must not silently receive
        // everything: a duplicated param arrives as an array, and an empty
        // string names nothing.
        it('refuses a malformed appUid instead of listing everything', async () => {
            const owner = await makeUser();
            expect(
                (await get('/share/shared-by-me', owner.token, { appUid: '' }))
                    .status,
            ).toBe(400);
            expect(
                (
                    await get(
                        '/share/shared-by-me?appUid=a&appUid=a',
                        owner.token,
                        {},
                    )
                ).status,
            ).toBe(400);
        });

        // The two directions of one listing; a gate on only one of them is a
        // hole in whichever was forgotten.
        it('is gated like the inbound listing', () => {
            const proto = ShareController.prototype as {
                __puterRoutes?: Array<{
                    method: string;
                    path: string;
                    options?: Record<string, unknown>;
                }>;
            };
            const routes = proto.__puterRoutes ?? [];
            const inbound = routes.find((r) => r.path === '/shared-with-me');
            const outbound = routes.find((r) => r.path === '/shared-by-me');
            expect(outbound?.method.toLowerCase()).toBe('get');
            expect(outbound?.options).toEqual(inbound?.options);
        });
    });

    describe('the outbound listing scoped to an app', () => {
        const actorFor = async (username: string) => {
            const user = await env.server.stores.user.getByUsername(username);
            return makeActor({ user: user! });
        };

        /** An app of the user's, with a token and reach over one file. */
        const makeApp = async (
            owner: { username: string },
            file: { uid: string },
        ) => {
            const actor = await actorFor(owner.username);
            const app = await env.server.stores.app.create(
                {
                    name: `share-http-app-${crypto.randomUUID()}`,
                    title: 'Share app',
                    index_url: `https://share-${crypto.randomUUID()}.test/`,
                },
                { ownerUserId: actor.user.id },
            );
            await runWithContext({ actor }, () =>
                env.server.services.permission.grantUserAppPermission(
                    actor,
                    app.uid,
                    `fs:${file.uid}:read`,
                ),
            );
            const token = await env.server.services.auth.getUserAppToken(
                actor,
                app.uid,
            );
            return { ...app, token };
        };

        /** An owner whose two apps have each shared a file of theirs. */
        const twoApps = async () => {
            const owner = await makeUser();
            const recipient = await makeUser();
            const files = [await makeFile(owner), await makeFile(owner)];
            const apps = [
                await makeApp(owner, files[0]),
                await makeApp(owner, files[1]),
            ];
            for (const [index, app] of apps.entries()) {
                const res = await post('/share', app.token, {
                    recipients: [recipient.username],
                    items: [{ uid: files[index].uid }],
                    mode: 'read',
                });
                expect(res.status).toBe(200);
            }
            return { owner, recipient, files, apps };
        };

        it('shows an app its own grants only', async () => {
            const { files, apps } = await twoApps();

            for (const [index, app] of apps.entries()) {
                const body = (await (
                    await get('/share/shared-by-me', app.token, {
                        includeTotal: 'true',
                    })
                ).json()) as {
                    items: Array<Record<string, unknown>>;
                    total?: number;
                };
                expect(body.items.map((i) => i.uid_entry)).toEqual([
                    files[index].uid,
                ]);
                expect(body.items[0].issued_by_app).toBe(app.uid);
                expect(body.total).toBe(1);
            }

            // Naming the other app changes nothing: the credential is the scope.
            const crossed = (await (
                await get('/share/shared-by-me', apps[0].token, {
                    appUid: apps[1].uid,
                })
            ).json()) as { items: unknown[] };
            expect(crossed.items).toEqual([]);
        });

        it('groups a session listing by app and drills back in', async () => {
            const { owner, recipient, files, apps } = await twoApps();
            const byHand = await makeFile(owner);
            await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: byHand.uid }],
                mode: 'read',
            });

            const grouped = (await (
                await get('/share/shared-by-me/apps', owner.token, {
                    includeTotal: 'true',
                })
            ).json()) as {
                items: Array<{
                    appUid: string | null;
                    name: string | null;
                    count: number;
                }>;
                total?: number;
            };
            expect(grouped.total).toBe(3);
            const byApp = new Map(grouped.items.map((i) => [i.appUid, i]));
            expect(byApp.get(null)?.count).toBe(1);
            expect(byApp.get(apps[0].uid)).toMatchObject({
                name: apps[0].name,
                count: 1,
            });

            const drilled = (await (
                await get('/share/shared-by-me', owner.token, {
                    appUid: apps[0].uid,
                })
            ).json()) as { items: Array<{ uid_entry: string }> };
            expect(drilled.items.map((i) => i.uid_entry)).toEqual([
                files[0].uid,
            ]);

            const manual = (await (
                await get('/share/shared-by-me', owner.token, {
                    appUid: 'none',
                })
            ).json()) as { items: Array<{ uid_entry: string }> };
            expect(manual.items.map((i) => i.uid_entry)).toEqual([byHand.uid]);
        });

        it('keeps the grouped view off app tokens', async () => {
            const { apps } = await twoApps();
            const res = await get('/share/shared-by-me/apps', apps[0].token, {});
            expect(res.status).toBe(403);
        });

        it('revokes a listed share, and answers 404 for one that is not the caller\'s', async () => {
            const { owner, apps } = await twoApps();
            const stranger = await makeUser();
            const listed = (await (
                await get('/share/shared-by-me', apps[1].token, {})
            ).json()) as { items: Array<{ uid: string }> };
            const uid = listed.items[0].uid;

            expect((await del(`/share/shared-by-me/${uid}`, apps[0].token)).status)
                .toBe(404);
            expect(
                (await del(`/share/shared-by-me/${uid}`, stranger.token)).status,
            ).toBe(404);
            expect(
                (
                    await del(
                        `/share/shared-by-me/${crypto.randomUUID()}`,
                        owner.token,
                    )
                ).status,
            ).toBe(404);

            const revoked = await del(`/share/shared-by-me/${uid}`, owner.token);
            expect(revoked.status).toBe(200);
            expect(await revoked.json()).toMatchObject({ uid, revoked: 1 });

            const after = (await (
                await get('/share/shared-by-me', apps[1].token, {})
            ).json()) as { items: Array<{ uid: string }> };
            expect(after.items).toEqual([]);
        });

        it('reads the grant audit trail, and keeps it after a revoke', async () => {
            const { owner, recipient, files, apps } = await twoApps();

            const trail = async (token: string, params = {}) =>
                (await (await get('/share/audit', token, params)).json()) as {
                    items: Array<Record<string, unknown>>;
                    total?: number;
                };

            const granted = await trail(owner.token, {
                uid: files[0].uid,
                includeTotal: 'true',
            });
            expect(granted.total).toBe(granted.items.length);
            expect(granted.items[0]).toMatchObject({
                action: 'grant',
                entryUid: files[0].uid,
                issuer: owner.username,
                holder: recipient.username,
                appUid: apps[0].uid,
            });
            // Nothing internal rides along.
            for (const key of ['issuer_user_id', 'holder_user_id', 'reason']) {
                expect(granted.items[0]).not.toHaveProperty(key);
            }

            await post('/share/revoke', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: files[0].uid }],
            });
            const afterRevoke = await trail(owner.token, {
                uid: files[0].uid,
            });
            expect(
                afterRevoke.items.map((i) => i.action),
            ).toEqual(expect.arrayContaining(['grant', 'revoke']));
        });

        it('will not hand one account the trail of another\'s', async () => {
            const { files } = await twoApps();
            const stranger = await makeUser();

            const res = await get('/share/audit', stranger.token, {
                uid: files[0].uid,
            });
            expect(res.status).toBe(404);

            // Their own listing is theirs alone, and they have granted nothing.
            const own = (await (
                await get('/share/audit', stranger.token, {})
            ).json()) as { items: unknown[] };
            expect(own.items).toEqual([]);
        });

        it('keeps the audit trail off app tokens', async () => {
            const { apps, files } = await twoApps();
            const res = await get('/share/audit', apps[0].token, {
                uid: files[0].uid,
            });
            expect(res.status).toBe(403);
        });
    });

    it('revokes every item in the request, not just the first', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const fileA = await makeFile(owner);
        const fileB = await makeFile(owner);

        for (const file of [fileA, fileB]) {
            const res = await post('/share', owner.token, {
                recipients: [recipient.username],
                items: [{ uid: file.uid }],
                mode: 'read',
            });
            expect(res.status).toBe(200);
        }

        // A truncated revoke is a silent security failure: the caller is told
        // "success" while items after the first keep their grants.
        const revokeRes = await post('/share/revoke', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: fileA.uid }, { uid: fileB.uid }],
        });
        expect(revokeRes.status).toBe(200);
        expect(await revokeRes.json()).toMatchObject({
            status: 'success',
            revoked: 2,
        });

        const afterRes = await get('/share/shared-with-me', recipient.token, {});
        const after = (await afterRes.json()) as {
            items: Array<Record<string, unknown>>;
        };
        for (const file of [fileA, fileB]) {
            expect(
                after.items.find((i) => i.uid_entry === file.uid),
            ).toBeUndefined();
        }
    });

    it('accepts tilde-rooted paths the way the FS routes do', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);
        const tildePath = `~/${file.path.split('/').pop()}`;

        const shareRes = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [tildePath],
            mode: 'read',
        });
        expect(shareRes.status).toBe(200);
        expect(await shareRes.json()).toMatchObject({ status: 'success' });

        const listRes = await get('/share/shares', owner.token, {
            path: tildePath,
        });
        expect(listRes.status).toBe(200);
        const listed = (await listRes.json()) as {
            items: Array<{ holder: string }>;
        };
        expect(
            listed.items.some((i) => i.holder === recipient.username),
        ).toBe(true);

        const revokeRes = await post('/share/revoke', owner.token, {
            recipients: [recipient.username],
            items: [tildePath],
        });
        expect(revokeRes.status).toBe(200);
        expect(await revokeRes.json()).toMatchObject({ revoked: 1 });
    });

    it('tells the recipient over the wire, once for the whole batch', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const [a, b] = [await makeFile(owner), await makeFile(owner)];

        // These accounts are shared between tests, so both things that would
        // otherwise decide this outcome are cleared first: the budgets that
        // silence a repeat interruption, and any notification still open for
        // this recipient, which a new share folds into instead of creating one.
        // What's left under test is the batching.
        const [issuer, holder] = await Promise.all([
            env.server.stores.user.getByUsername(owner.username),
            env.server.stores.user.getByUsername(recipient.username),
        ]);
        await env.server.clients.redis.del(
            `rate:share:notify:pair:${issuer!.id}:${holder!.id}`,
            `rate:share:notify:pair-day:${issuer!.id}:${holder!.id}`,
            `rate:share:notify:to:${holder!.id}`,
            `rate:share:notify:to-day:${holder!.id}`,
        );
        for (const row of await env.server.stores.notification.listByUserId(
            holder!.id,
            { filter: 'unacknowledged' },
        )) {
            await env.server.stores.notification.markAcknowledged(
                row.uid,
                holder!.id,
            );
        }

        const seen: Array<{
            userIds: number[];
            payload: Record<string, unknown>;
            type: string;
        }> = [];
        const notification = env.server.services.notification;
        const original = notification.notify.bind(notification);
        notification.notify = async (userIds, payload, opts) => {
            seen.push({ userIds, payload, type: opts.type });
            return original(userIds, payload, opts);
        };

        try {
            const res = await post('/share', owner.token, {
                items: [{ path: a.path }, { path: b.path }],
                recipients: [{ username: recipient.username }],
                mode: 'read',
            });
            expect(res.status).toBe(200);

            // Delivery is off the response path, so it may land just after.
            await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0), {
                timeout: 5000,
            });
        } finally {
            notification.notify = original;
        }

        // Two items, one recipient — one notification carrying the count.
        expect(seen).toHaveLength(1);
        expect(seen[0].type).toBe('share.received');
        expect(seen[0].payload).toMatchObject({
            fields: { count: 2 },
        });
    });

    it('reports per-pair outcomes when only some recipients resolve', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        const res = await post('/share', owner.token, {
            recipients: [env.users.other.username, 'nosuchuser-zzz'],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            status: string;
            results: Array<{ status: string; recipient: string }>;
        };
        expect(body.status).toBe('mixed');
        expect(body.results).toHaveLength(2);
        expect(
            body.results.find((r) => r.recipient === 'nosuchuser-zzz')?.status,
        ).toBe('error');
    });

    it('lists who can reach an item for its owner', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);

        await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'write',
        });

        const res = await get('/share/shares', owner.token, { uid: file.uid });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            items: Array<{ holder: string; mode: string }>;
        };
        expect(body.items).toHaveLength(1);
        expect(body.items[0].holder).toBe(recipient.username);
        expect(body.items[0].mode).toBe('write');
    });

    it('hides an item from a stranger asking who can reach it', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        const res = await get('/share/shares', env.users.other.token, {
            uid: file.uid,
        });
        expect(res.status).toBe(404);
    });


    it('runs a duplicated pair once, and answers for both positions', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const invitee = `dup-${crypto.randomUUID().slice(0, 8)}@puter.local`;

        // The same pair twice raced itself into two pending rows; it must
        // execute once, with the one outcome reported in both positions.
        const res = await post('/share', owner.token, {
            recipients: [invitee],
            items: [{ uid: file.uid }, { uid: file.uid }],
            mode: 'read',
        });
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            status: string;
            results: Array<{ status: string; uid?: string }>;
        };
        expect(body.results).toHaveLength(2);
        expect(body.results[0].status).toBe('pending');
        expect(body.results[1]).toEqual(body.results[0]);

        const rows = await env.server.stores.share.listPendingByEmail(invitee);
        expect(rows).toHaveLength(1);
    });

    it('rejects an unauthenticated share', async () => {
        const res = await fetch(new URL('/share', env.apiOrigin), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipients: ['x'], items: ['y'] }),
        });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
    });

    it('caps how many recipients one request can reach', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);
        const many = Array.from({ length: 64 }, (_, i) => `user-${i}`);

        const res = await post('/share', owner.token, {
            recipients: many,
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({
            code: 'too_many_recipients',
        });
    });

    it('caps how many items one request can carry', async () => {
        const owner = env.users.user;
        const many = Array.from({ length: 128 }, () => ({
            uid: crypto.randomUUID(),
        }));

        const res = await post('/share', owner.token, {
            recipients: [env.users.other.username],
            items: many,
            mode: 'read',
        });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'too_many_items' });
    });

    it('rejects a request with no recipients or no items', async () => {
        const owner = env.users.user;
        const file = await makeFile(owner);

        expect(
            (await post('/share', owner.token, { items: [{ uid: file.uid }] }))
                .status,
        ).toBe(400);
        expect(
            (
                await post('/share', owner.token, {
                    recipients: [env.users.other.username],
                })
            ).status,
        ).toBe(400);
    });

    it('blocks a sender, refuses their share, then unblocks them', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);

        const blocked = await post('/share/blocks', recipient.token, {
            username: owner.username,
        });
        expect(blocked.status).toBe(200);
        expect(await blocked.json()).toMatchObject({
            username: owner.username,
            blocked: true,
            created: true,
        });

        const refused = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        // A per-pair outcome, so the envelope reports it rather than the status.
        expect(refused.status).toBe(200);
        expect(await refused.json()).toMatchObject({
            status: 'aborted',
            results: [{ status: 'error', code: 'recipient_not_accepting_shares' }],
        });

        const listed = await get('/share/blocks', recipient.token, {});
        expect(listed.status).toBe(200);
        const body = (await listed.json()) as {
            items: Array<Record<string, unknown>>;
        };
        const row = body.items.find((i) => i.username === owner.username);
        expect(row).toBeDefined();
        expect(typeof row?.created_at).toBe('number');
        // Nothing internal rides along.
        for (const key of ['blocker_user_id', 'blocked_user_id', 'id']) {
            expect(row).not.toHaveProperty(key);
        }

        const unblocked = await fetch(new URL('/share/blocks', env.apiOrigin), {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${recipient.token}`,
            },
            body: JSON.stringify({ username: owner.username }),
        });
        expect(unblocked.status).toBe(200);
        expect(await unblocked.json()).toMatchObject({ unblocked: true });

        const shared = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(await shared.json()).toMatchObject({ status: 'success' });
    });

    it('requires a username to block', async () => {
        const res = await post('/share/blocks', env.users.other.token, {});
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'bad_request' });
    });

    it('refuses every sender while the blanket switch is on', async () => {
        const owner = env.users.user;
        const recipient = env.users.other;
        const file = await makeFile(owner);
        const del = (body: unknown) =>
            fetch(new URL('/share/blocks', env.apiOrigin), {
                method: 'DELETE',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${recipient.token}`,
                },
                body: JSON.stringify(body),
            });

        const on = await post('/share/blocks', recipient.token, { all: true });
        expect(on.status).toBe(200);
        expect(await on.json()).toMatchObject({ all: true, blocked: true });

        const listed = await get('/share/blocks', recipient.token, {});
        expect(await listed.json()).toMatchObject({ all: true, items: [] });

        const refused = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(await refused.json()).toMatchObject({
            status: 'aborted',
            results: [
                { status: 'error', code: 'recipient_not_accepting_shares' },
            ],
        });

        const off = await del({ all: true });
        expect(off.status).toBe(200);
        expect(await off.json()).toMatchObject({ all: false, blocked: false });

        const shared = await post('/share', owner.token, {
            recipients: [recipient.username],
            items: [{ uid: file.uid }],
            mode: 'read',
        });
        expect(await shared.json()).toMatchObject({ status: 'success' });

        // Cleaned up so a later assertion on this recipient isn't reading
        // state this test left behind.
        expect((await del({ all: true })).status).toBe(200);
    });

    it('keeps one caller\'s blocklist out of another\'s', async () => {
        const res = await get('/share/blocks', env.users.admin.token, {});
        const body = (await res.json()) as { all: boolean; items: unknown[] };
        expect(body).toEqual({ all: false, items: [] });
    });

    // Reading it says who the user avoids; clearing it puts them back in touch.
    it('is closed to an app acting for the user', async () => {
        const user = env.users.user;
        const minted = await post('/auth/get-user-app-token', user.token, {
            origin: 'https://blocks-probe.example',
        });
        expect(minted.status).toBe(200);
        const appToken = ((await minted.json()) as { token: string }).token;
        expect(typeof appToken).toBe('string');

        const asApp = [
            get('/share/blocks', appToken, {}),
            post('/share/blocks', appToken, { all: true }),
            fetch(new URL('/share/blocks', env.apiOrigin), {
                method: 'DELETE',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${appToken}`,
                },
                body: JSON.stringify({ all: true }),
            }),
        ];
        for (const res of await Promise.all(asApp)) {
            expect(res.status).toBe(403);
            expect(await res.json()).toMatchObject({ code: 'forbidden' });
        }

        // The same calls from the user's own session: the app is what is refused.
        expect((await get('/share/blocks', user.token, {})).status).toBe(200);
        expect(
            (await post('/share/blocks', user.token, { all: true })).status,
        ).toBe(200);
        const lifted = await fetch(new URL('/share/blocks', env.apiOrigin), {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${user.token}`,
            },
            body: JSON.stringify({ all: true }),
        });
        expect(lifted.status).toBe(200);
    });

    // So a fourth block route cannot quietly ship without the gate.
    it('gates every block route on a user session', () => {
        const proto = ShareController.prototype as {
            __puterRoutes?: Array<{
                method: string;
                path: string;
                options?: Record<string, unknown>;
            }>;
        };
        const blocks = (proto.__puterRoutes ?? []).filter(
            (r) => r.path === '/blocks',
        );
        expect(blocks.map((r) => r.method.toLowerCase()).sort()).toEqual([
            'delete',
            'get',
            'post',
        ]);
        for (const route of blocks) {
            expect(
                route.options?.requireUserActor,
                `${route.method} /blocks`,
            ).toBe(true);
            // Security management stays closed to every access token.
            expect(route.options?.allowFullAccessToken).toBeUndefined();
        }
    });
});
