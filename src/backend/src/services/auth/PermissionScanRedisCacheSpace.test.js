import { describe, expect, it } from 'vitest';
import { PermissionScanRedisCacheSpace } from './PermissionScanRedisCacheSpace.js';
import { PermissionUtil } from './permissionUtils.mjs';

describe('PermissionScanRedisCacheSpace', () => {
    it('builds cache keys for actor and permission options', () => {
        const actorUid = 'app-under-user:user-123:app-456';
        const permissionOptions = ['fs:node-1:read'];
        const key = PermissionScanRedisCacheSpace.key({
            actorUid,
            permissionOptions,
            joinPermissionParts: PermissionUtil.join,
        });

        expect(key).toBe(PermissionUtil.join(
            'permission-scan',
            actorUid,
            'options-list',
            ...permissionOptions,
        ));
    });

    it('builds stable exact keys for app-under-user + one permission', () => {
        const actorUid = 'app-under-user:user-123:app-456';
        const permissionOptions = ['flag:app-is-authenticated'];
        const key = PermissionScanRedisCacheSpace.key({
            actorUid,
            permissionOptions,
            joinPermissionParts: PermissionUtil.join,
        });

        expect(key).toBe(PermissionUtil.join(
            'permission-scan',
            actorUid,
            'options-list',
            ...permissionOptions,
        ));
    });
});
