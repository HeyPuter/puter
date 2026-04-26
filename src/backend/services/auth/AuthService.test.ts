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
