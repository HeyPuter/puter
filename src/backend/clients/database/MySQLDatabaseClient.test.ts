/**
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

import { describe, expect, it, vi } from 'vitest';
import type { IConfig } from '../../types';
import {
    MySQLDatabaseClient,
    compareMigrationFilenames,
} from './MySQLDatabaseClient.js';

describe('compareMigrationFilenames', () => {
    it('orders numbered migrations numerically, not lexically', () => {
        const input = [
            'mysql_mig_10.sql',
            'mysql_mig_2.sql',
            'mysql_mig_1.sql',
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
        ];
        const sorted = [...input].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_3.sql',
            'mysql_mig_9.sql',
            'mysql_mig_10.sql',
        ]);
    });

    it('keeps mig_10 after mig_9 when the real prod set is shuffled', () => {
        // Reflects the current migrations/mysql/ listing — guards against
        // a future "let's just rename to padded" suggestion accidentally
        // re-introducing the lex bug if the rename is incomplete.
        const real = [
            'mysql_mig_9.sql',
            'mysql_mig_3.sql',
            'mysql_mig_10.sql',
            'mysql_mig_1.sql',
            'mysql_mig_7.sql',
            'mysql_mig_5.sql',
            'mysql_mig_2.sql',
            'mysql_mig_4.sql',
            'mysql_mig_8.sql',
            'mysql_mig_6.sql',
        ];
        const sorted = [...real].sort(compareMigrationFilenames);
        for (let i = 1; i <= sorted.length; i += 1) {
            expect(sorted[i - 1]).toBe(`mysql_mig_${i}.sql`);
        }
    });

    it('sorts non-numeric filenames after numbered ones, lexically among themselves', () => {
        // Numbered files always run first (they're the canonical history);
        // unmatched names follow in localeCompare order. Mixing the two
        // sets prevents a vendor dump from accidentally wedging itself
        // between mig_4 and mig_5 if it happened to lex-sort there.
        const mixed = [
            'mysql_mig_2.sql',
            'mysql_vendor_dump.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_mig_1.sql',
        ];
        const sorted = [...mixed].sort(compareMigrationFilenames);
        expect(sorted).toEqual([
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_bootstrap.sql',
            'mysql_vendor_dump.sql',
        ]);
    });

    it('is stable for already-sorted input', () => {
        const sorted = [
            'mysql_mig_1.sql',
            'mysql_mig_2.sql',
            'mysql_mig_10.sql',
            'mysql_mig_11.sql',
        ];
        expect([...sorted].sort(compareMigrationFilenames)).toEqual(sorted);
    });
});

// ── Replica read failover ───────────────────────────────────────────
//
// `read()` normally goes to the replica batcher; when the replica side is
// degraded (batcher load-shed or a transient connection error) and a real
// replica is configured, the read retries once on the primary batcher.

type Batcher = { execute: ReturnType<typeof vi.fn> };

const makeClient = (opts: {
    replica: Batcher;
    primary: Batcher;
    multiNode?: boolean;
}) => {
    const client = new MySQLDatabaseClient({
        database: { engine: 'mysql' },
    } as IConfig);
    // Bypass onServerStart (which would connect to a real database) and
    // inject the batchers directly. Configuration enum: SINGLE=0, REPLICA=1.
    Object.assign(client as unknown as Record<string, unknown>, {
        dbReplica: opts.replica,
        db: opts.primary,
        configuration: opts.multiNode === false ? 0 : 1,
    });
    return client;
};

const codedError = (code: string) => {
    const err = new Error(code) as Error & { code: string };
    err.code = code;
    return err;
};

describe('MySQLDatabaseClient.read — replica failover', () => {
    it('fails over to the primary on batcher load-shed errors', async () => {
        const replica = { execute: vi.fn().mockRejectedValue(codedError('dbBatchFailed')) };
        const primary = { execute: vi.fn().mockResolvedValue([[{ ok: 1 }]]) };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
        expect(primary.execute).toHaveBeenCalledTimes(1);
    });

    it('fails over on transient connection errors', async () => {
        const replica = { execute: vi.fn().mockRejectedValue(codedError('ECONNRESET')) };
        const primary = { execute: vi.fn().mockResolvedValue([[{ ok: 1 }]]) };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELECT 1')).resolves.toEqual([{ ok: 1 }]);
    });

    it('rethrows deterministic SQL errors without touching the primary', async () => {
        const replica = { execute: vi.fn().mockRejectedValue(codedError('ER_PARSE_ERROR')) };
        const primary = { execute: vi.fn() };
        const client = makeClient({ replica, primary });

        await expect(client.read('SELEC oops')).rejects.toMatchObject({
            code: 'ER_PARSE_ERROR',
        });
        expect(primary.execute).not.toHaveBeenCalled();
    });

    it('does not fail over in single-node configuration', async () => {
        const replica = { execute: vi.fn().mockRejectedValue(codedError('dbBatchFailed')) };
        const primary = { execute: vi.fn() };
        const client = makeClient({ replica, primary, multiNode: false });

        await expect(client.read('SELECT 1')).rejects.toMatchObject({
            code: 'dbBatchFailed',
        });
        expect(primary.execute).not.toHaveBeenCalled();
    });
});
