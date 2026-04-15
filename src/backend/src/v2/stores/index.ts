import { AppStore } from './app/AppStore.js';
import { GroupStore } from './group/GroupStore';
import { NotificationStore } from './notification/NotificationStore.js';
import { PermissionStore } from './permission/PermissionStore';
import { SessionStore } from './session/SessionStore';
import { SubdomainStore } from './subdomain/SubdomainStore.js';
import { SystemKVStore } from './systemKv/SystemKVStore';
import { UserStore } from './user/UserStore';
import type { IPuterStoreRegistry } from './types';

// Ordering matters: stores declared later see earlier ones as peers.
// PermissionStore depends on `kv`, so `kv` must come first.
// UserStore / AppStore are leaves (db + redis only); sit early so other
// stores/services can lean on them for cached lookups.
// SessionStore is leaf — only uses clients.db.
export const puterStores = {
    kv: SystemKVStore,
    user: UserStore,
    app: AppStore,
    subdomain: SubdomainStore,
    notification: NotificationStore,
    group: GroupStore,
    permission: PermissionStore,
    session: SessionStore,
} satisfies IPuterStoreRegistry;
