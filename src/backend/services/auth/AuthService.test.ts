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

import { describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { AuthService } from './AuthService.js';

function createAuthService(): AuthService {
    const [config, clients, stores, services] = [
        {},
        {},
        {},
        {},
    ] as ConstructorParameters<typeof AuthService>;
    return new AuthService(config, clients, stores, services);
}

describe('AuthService.createAccessToken', () => {
    it('rejects access-token actors so scoped tokens cannot mint broader tokens', async () => {
        const authService = createAuthService();
        const issuer: Actor = {
            user: {
                uuid: 'user-issuer',
                id: 1,
                username: 'issuer',
            },
        };
        const actor: Actor = {
            user: {
                uuid: 'user-issuer',
                id: 1,
                username: 'issuer',
            },
            accessToken: {
                uid: 'token-existing',
                issuer,
                authorized: null,
            },
        };

        await expect(
            authService.createAccessToken(actor, [['fs:abc:read']]),
        ).rejects.toMatchObject({
            statusCode: 403,
            legacyCode: 'forbidden',
        });
    });
});
