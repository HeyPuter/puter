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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { awsCredentialsFrom } from './awsCredentials.js';

describe('awsCredentialsFrom', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('returns the static keys', () => {
        expect(
            awsCredentialsFrom({
                access_key: 'AKIA-TEST',
                secret_key: 'secret',
            }),
        ).toEqual({ accessKeyId: 'AKIA-TEST', secretAccessKey: 'secret' });
    });

    it('returns null without both keys or the chain', () => {
        expect(awsCredentialsFrom(undefined)).toBeNull();
        expect(awsCredentialsFrom({ access_key: 'AKIA-TEST' })).toBeNull();
        expect(
            awsCredentialsFrom({ access_key: '', secret_key: '' }),
        ).toBeNull();
        expect(awsCredentialsFrom({ useCredentialChain: 'true' })).toBeNull();
    });

    it('prefers the credential chain over keys, sharing one provider', async () => {
        vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIA-CHAIN');
        vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'chain-secret');

        const first = awsCredentialsFrom({
            useCredentialChain: true,
            access_key: 'AKIA-TEST',
            secret_key: 'secret',
        });
        const second = awsCredentialsFrom({ useCredentialChain: true });

        expect(typeof first).toBe('function');
        expect(second).toBe(first);
        await expect(
            (first as () => Promise<unknown>)(),
        ).resolves.toMatchObject({
            accessKeyId: 'AKIA-CHAIN',
            secretAccessKey: 'chain-secret',
        });
    });
});
