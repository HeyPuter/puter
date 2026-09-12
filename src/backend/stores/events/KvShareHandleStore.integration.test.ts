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

/**
 * The store's own guard against a row wider than the column that holds it.
 *
 * `EventsService.mintKvHandle` already bounds `keyPrefix` and `permission` well
 * under these widths before the store ever sees them, so reaching the guard
 * here means calling the store directly.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isHttpError } from '../../core/http/HttpError.js';
import { setupPuterTestEnv, type PuterTestEnv } from '../../testUtil.js';
import type { IConfig } from '../../types.js';
import { KV_SHARE_HANDLE_WIDTHS } from './columnWidths.js';
import type { MintKvShareHandleInput } from './KvShareHandleStore.js';

const BOOT_TIMEOUT_MS = 120_000;

let env: PuterTestEnv;
let ownerUserId: number;
let granteeUserId: number;

const store = () => env.server.stores.kvShareHandle;

const input = (
    over: Partial<MintKvShareHandleInput> = {},
): MintKvShareHandleInput => ({
    ownerUserId,
    granteeUserId,
    appUid: 'app-column-widths',
    keyPrefix: 'workspace:',
    permission: 'kv-share:owner-uuid:app-column-widths:workspace',
    ...over,
});

const codeOf = (code: string) => (err: unknown) =>
    isHttpError(err) && err.legacyCode === code;

beforeAll(async () => {
    env = await setupPuterTestEnv({ events: { enabled: true } } as IConfig);
    const owner = await env.server.stores.user.getByUsername(
        env.users.user.username,
    );
    ownerUserId = owner!.id;
    const grantee = await env.server.stores.user.getByUsername(
        env.users.other.username,
    );
    granteeUserId = grantee!.id;
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    await env?.shutdown();
});

describe('minting rejects a value the column would truncate', () => {
    it('accepts a `keyPrefix` right at the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.keyPrefix.max;
        const row = await store().mint(input({ keyPrefix: 'a'.repeat(max) }));
        expect(row.keyPrefix).toBe('a'.repeat(max));
    });

    it('refuses a `keyPrefix` one character over the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.keyPrefix.max;
        await expect(
            store().mint(input({ keyPrefix: 'a'.repeat(max + 1) })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });

    it('accepts a `permission` right at the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.permission.max;
        const row = await store().mint(input({ permission: 'a'.repeat(max) }));
        expect(row.permission).toBe('a'.repeat(max));
    });

    it('refuses a `permission` one character over the column width', async () => {
        const max = KV_SHARE_HANDLE_WIDTHS.permission.max;
        await expect(
            store().mint(input({ permission: 'a'.repeat(max + 1) })),
        ).rejects.toSatisfy(codeOf('events_value_too_large'));
    });
});
