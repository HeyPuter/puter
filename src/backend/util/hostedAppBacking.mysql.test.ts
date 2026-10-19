import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    createTestUser,
    setupPuterTestEnv,
    type PuterTestEnv,
    type TestUserCredentials,
} from '../testUtil.js';

const MYSQL = {
    host: '127.0.0.1',
    port: Number(process.env.PUTER_TEST_MYSQL_PORT ?? 3307),
    user: 'root',
    password: 'puter',
};
const DB = `origin_isolation_${Date.now().toString(36)}`;
const MIGRATIONS = fileURLToPath(
    new URL('../clients/database/migrations/mysql', import.meta.url),
);
const HOSTED = 'site.puter.localhost';

const tag = () => Math.random().toString(36).slice(2, 8);
const accentedOf = (name: string) => name.replace('i', 'í');
const punycodeLabelOf = (label: string) =>
    new URL(`https://${label}.${HOSTED}/`).hostname.slice(
        0,
        -`.${HOSTED}`.length,
    );

describe.skipIf(!process.env.PUTER_TEST_MYSQL_PORT)(
    'hosted origin app isolation (MySQL)',
    () => {
        let env: PuterTestEnv;
        let visitor: TestUserCredentials;

        beforeAll(async () => {
            const admin = await mysql.createConnection(MYSQL);
            await admin.query(`CREATE DATABASE \`${DB}\``);
            await admin.end();
            env = await setupPuterTestEnv({
                database: {
                    engine: 'mysql',
                    ...MYSQL,
                    database: DB,
                    migrationPaths: [MIGRATIONS],
                },
            } as never);
            visitor = await createTestUser(env.server, {
                username: 'visitor20c',
                password: 'visitor20c-password',
            });
        }, 240_000);

        afterAll(async () => {
            await env?.shutdown();
            const admin = await mysql.createConnection(MYSQL);
            await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
            await admin.end();
        });

        const post = async (
            token: string,
            path: string,
            body: Record<string, unknown>,
        ) => {
            const res = await fetch(new URL(path, env.apiOrigin), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            let json: Record<string, any> | null = null;
            try {
                json = await res.json();
            } catch {
                json = null;
            }
            return { status: res.status, json };
        };

        const driver = (
            token: string,
            iface: string,
            method: string,
            args: Record<string, unknown>,
        ) => post(token, '/drivers/call', { interface: iface, method, args });

        const createSite = async (token: string, subdomain: string) =>
            driver(token, 'puter-subdomains', 'create', {
                object: { subdomain, root_dir: '~/Public' },
            });

        const createApp = async (token: string, indexUrl: string) =>
            driver(token, 'puter-apps', 'create', {
                object: {
                    name: `v20c-${tag()}`,
                    title: 'Any',
                    index_url: indexUrl,
                },
            });

        const appUid = (r: { json: Record<string, any> | null }) =>
            (r.json?.result?.uid ?? r.json?.uid) as string | undefined;

        const bootstrapRows = async (origin: string) => {
            const label = new URL(origin).hostname.split('.')[0];
            const rows = await env.server.clients.db.pread(
                'SELECT `uid` FROM `apps` WHERE `description` LIKE ? COLLATE utf8mb4_bin',
                [`App created from origin %://${label}.%`],
            );
            return rows.length;
        };

        it('keeps distinct hosted origins in separate app namespaces', async () => {
            const B = env.users.other;
            const A = env.users.user;
            const name = `victim${tag()}`;
            const victimOrigin = `https://${name}.${HOSTED}`;

            expect((await createSite(B.token, name)).status).toBe(200);

            const label = punycodeLabelOf(accentedOf(name));
            expect(label.startsWith('xn--')).toBe(true);
            expect((await createSite(A.token, label)).status).toBe(200);

            const created = await createApp(
                A.token,
                `https://${accentedOf(name)}.${HOSTED}/`,
            );
            expect(created.status).toBe(200);
            const attackerUid = appUid(created)!;
            expect(attackerUid).toMatch(/^app-/);

            const signIn = await post(
                visitor.token,
                '/auth/get-user-app-token',
                {
                    origin: victimOrigin,
                },
            );
            expect(signIn.status).toBe(200);
            expect(signIn.json?.app_uid).not.toBe(attackerUid);
            expect(await bootstrapRows(victimOrigin)).toBe(1);

            const write = await driver(
                signIn.json!.token,
                'puter-kvstore',
                'set',
                { key: 'note', value: 'written on victim site' },
            );
            expect(write.status).toBe(200);

            const launch = await post(
                visitor.token,
                '/auth/get-user-app-token',
                {
                    app_uid: attackerUid,
                },
            );
            expect(launch.status).toBe(200);
            const read = await driver(
                launch.json!.token,
                'puter-kvstore',
                'get',
                { key: 'note' },
            );
            expect(read.status).toBe(200);
            expect(JSON.stringify(read.json)).not.toContain(
                'written on victim site',
            );

            const stored = await env.server.stores.app.getByUid(attackerUid);
            expect(stored!.index_url).toBe(
                new URL(`https://${accentedOf(name)}.${HOSTED}/`).href,
            );
            expect(new URL(stored!.index_url as string).hostname).toBe(
                `${label}.${HOSTED}`,
            );

            const own = await createApp(B.token, `${victimOrigin}/`);
            expect(own.status).toBe(200);
        }, 60_000);

        it('matches legacy Unicode rows only to their own punycode origin', async () => {
            const created = await createApp(
                env.users.user.token,
                'https://legacy.example.test/',
            );
            const uid = appUid(created)!;
            await env.server.clients.db.write(
                'UPDATE apps SET index_url = ? WHERE uid = ?',
                ['https://víctim.example.test/', uid],
            );
            const store = env.server.stores.app;
            expect(await store.listIndexUrlWinners([
                new URL('https://víctim.example.test/').href,
                'https://victim.example.test/',
            ])).toHaveLength(1);
            expect(
                await store.findCanonicalUidByIndexUrlCandidates([
                    'https://victim.example.test/',
                ]),
            ).not.toBe(uid);
            expect(
                await store.findCanonicalUidByIndexUrlCandidates([
                    new URL('https://víctim.example.test/').href,
                ]),
            ).toBe(uid);
        });

        it('does not win once B’s site has had a sign-in (older bootstrap row)', async () => {
            const B = env.users.other;
            const A = env.users.user;
            const name = `victim${tag()}`;
            const victimOrigin = `https://${name}.${HOSTED}`;
            expect((await createSite(B.token, name)).status).toBe(200);

            const first = await post(
                visitor.token,
                '/auth/get-user-app-token',
                {
                    origin: victimOrigin,
                },
            );
            expect(first.status).toBe(200);
            const bUid = first.json!.app_uid as string;
            expect(await bootstrapRows(victimOrigin)).toBe(1);

            const label = punycodeLabelOf(accentedOf(name));
            expect((await createSite(A.token, label)).status).toBe(200);
            const created = await createApp(
                A.token,
                `https://${accentedOf(name)}.${HOSTED}/`,
            );
            expect(created.status).toBe(200);
            const attackerUid = appUid(created)!;

            const later = await post(
                visitor.token,
                '/auth/get-user-app-token',
                {
                    origin: victimOrigin,
                },
            );
            expect(later.json?.app_uid).toBe(bUid);
            expect(later.json?.app_uid).not.toBe(attackerUid);
        }, 60_000);

        it('allows the unaccented site to be created independently', async () => {
            const B = env.users.other;
            const A = env.users.user;
            const name = `victim${tag()}`;
            const label = punycodeLabelOf(accentedOf(name));
            expect((await createSite(A.token, label)).status).toBe(200);
            expect(
                (
                    await createApp(
                        A.token,
                        `https://${accentedOf(name)}.${HOSTED}/`,
                    )
                ).status,
            ).toBe(200);

            const site = await createSite(B.token, name);
            expect(site.status).toBe(200);
        }, 60_000);
    },
);
