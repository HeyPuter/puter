import { describe, expect, it } from 'vitest';
import type { Actor } from '../../core/actor.js';
import { PermissionService } from './PermissionService.js';

function createPermissionService(): PermissionService {
    const permissionStore = {
        getMultiCheckCache: async () => new Map<string, boolean>(),
        setMultiCheckCache: async () => undefined,
    };
    const [config, clients, stores, services] = [
        {},
        {},
        { permission: permissionStore },
        {},
    ] as ConstructorParameters<typeof PermissionService>;
    return new PermissionService(config, clients, stores, services);
}

describe('PermissionService.checkMany', () => {
    it('evaluates every uncached permission independently', async () => {
        const service = createPermissionService();
        const actor: Actor = {
            user: {
                uuid: 'user-1',
                id: 1,
                username: 'user',
            },
        };
        const checked: string[] = [];
        service.check = async (_actor, permissionOptions) => {
            const permission = String(permissionOptions);
            checked.push(permission);
            return permission === 'app:uid#a:access' ||
                permission === 'app:uid#b:access';
        };

        const result = await service.checkMany(actor, [
            'app:uid#a:access',
            'app:uid#b:access',
            'app:uid#c:access',
        ]);

        expect(result).toEqual(
            new Map([
                ['app:uid#a:access', true],
                ['app:uid#b:access', true],
                ['app:uid#c:access', false],
            ]),
        );
        expect(checked).toEqual([
            'app:uid#a:access',
            'app:uid#b:access',
            'app:uid#c:access',
        ]);
    });
});
