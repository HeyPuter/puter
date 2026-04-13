import { GroupStore } from './group/GroupStore';
import { PermissionStore } from './permission/PermissionStore';
import { SessionStore } from './session/SessionStore';
import { SystemKVStore } from './systemKv/SystemKVStore';
import { UserStore } from './user/UserStore';
import type { IPuterStoreRegistry } from './types';

// Ordering matters: stores declared later see earlier ones as peers.
// PermissionStore depends on `kv`, so `kv` must come first.
// UserStore is leaf (db + redis only); sits early so other stores/services
// can lean on it for cached user lookups.
// SessionStore is leaf — only uses clients.db.
export const puterStores = {
    kv: SystemKVStore,
    user: UserStore,
    group: GroupStore,
    permission: PermissionStore,
    session: SessionStore,
} satisfies IPuterStoreRegistry;
