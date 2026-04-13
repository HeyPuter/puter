import { GroupStore } from './group/GroupStore';
import { PermissionStore } from './permission/PermissionStore';
import { SystemKVStore } from './systemKv/SystemKVStore';
import type { IPuterStoreRegistry } from './types';

// Ordering matters: stores declared later see earlier ones as peers.
// PermissionStore depends on `kv`, so `kv` must come first.
// PermissionService (at the services layer) reads from `group`, but the
// group store has no store-layer peer dependencies of its own.
export const puterStores = {
    kv: SystemKVStore,
    group: GroupStore,
    permission: PermissionStore,
} satisfies IPuterStoreRegistry;
