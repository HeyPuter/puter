import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { v4 as uuidv4 } from 'uuid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashRecoveryCode } from '../../services/auth/OTPUtil.js';
import { setupTestServer } from '../../testUtil.js';
import type { PuterServer } from '../../server.js';

const connection = {
    host: '127.0.0.1',
    port: Number(process.env.PUTER_TEST_MYSQL_PORT ?? 3307),
    user: 'root',
    password: 'puter',
};
const database = `recovery_codes_${Date.now().toString(36)}`;

describe.skipIf(!process.env.PUTER_TEST_MYSQL_PORT)(
    'atomic recovery codes (MySQL)',
    () => {
        let server: PuterServer;
        beforeAll(async () => {
            const admin = await mysql.createConnection(connection);
            await admin.query(`CREATE DATABASE \`${database}\``);
            await admin.end();
            server = await setupTestServer({
                database: {
                    engine: 'mysql',
                    ...connection,
                    database,
                    migrationPaths: [
                        fileURLToPath(
                            new URL(
                                '../../clients/database/migrations/mysql',
                                import.meta.url,
                            ),
                        ),
                    ],
                },
            } as never);
        }, 240_000);
        afterAll(async () => {
            await server?.shutdown();
            const admin = await mysql.createConnection(connection);
            await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
            await admin.end();
        });

        const account = async (codes: string[]) => {
            const username = `recovery-${uuidv4().slice(0, 8)}`;
            const user = await server.stores.user.create({
                username,
                uuid: uuidv4(),
                password: null,
                email: null,
            });
            await server.stores.user.update(user.id, {
                otp_enabled: true,
                otp_recovery_codes: codes.map(hashRecoveryCode).join(','),
            });
            return user;
        };

        it('allows only one concurrent consumption of the same recovery code', async () => {
            const user = await account(['RECOVER1', 'RECOVER2']);
            const results = await Promise.all(
                Array.from({ length: 3 }, () =>
                    server.stores.user.consumeOtpRecoveryCode(
                        user.id,
                        hashRecoveryCode('RECOVER1'),
                    ),
                ),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            expect(
                (await server.stores.user.getById(user.id, { force: true }))!
                    .otp_recovery_codes,
            ).toBe(hashRecoveryCode('RECOVER2'));
        });

        it('consumes ten different concurrent codes without lost updates', async () => {
            const codes = Array.from({ length: 10 }, (_, i) => `RECOVER${i}`);
            const user = await account(codes);
            const results = await Promise.all(
                codes.map((code) =>
                    server.stores.user.consumeOtpRecoveryCode(
                        user.id,
                        hashRecoveryCode(code),
                    ),
                ),
            );
            expect(results.every(Boolean)).toBe(true);
            expect(
                (await server.stores.user.getById(user.id, { force: true }))!
                    .otp_recovery_codes,
            ).toBe('');
        });
    },
);
