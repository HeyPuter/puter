import { AppStore } from './app/AppStore.js';
import { FSEntryStore } from './fs/FSEntryStore.js';
import { GroupStore } from './group/GroupStore';
import { NotificationStore } from './notification/NotificationStore.js';
import { PermissionStore } from './permission/PermissionStore';
import { S3ObjectStore } from './fs/S3ObjectStore.js';
import { SessionStore } from './session/SessionStore';
import { ShareStore } from './share/ShareStore.js';
import { SubdomainStore } from './subdomain/SubdomainStore.js';
import { SystemKVStore } from './systemKv/SystemKVStore';
import { UserStore } from './user/UserStore';
import type { IPuterStoreRegistry } from './types';

// Ordering matters: stores declared later see earlier ones as peers.
// PermissionStore depends on `kv`, so `kv` must come first.
// UserStore / AppStore are leaves (db + redis only); sit early so other
// stores/services can lean on them for cached lookups.
// FSEntryStore depends on `kv` (pending-upload sessions live there).
// S3ObjectStore is a leaf (clients.s3 only).
// SessionStore / ShareStore are leaves — only use clients.db.
export const puterStores = {
    kv: SystemKVStore,
    user: UserStore,
    app: AppStore,
    fsEntry: FSEntryStore,
    s3Object: S3ObjectStore,
    subdomain: SubdomainStore,
    notification: NotificationStore,
    share: ShareStore,
    group: GroupStore,
    permission: PermissionStore,
    session: SessionStore,
} satisfies IPuterStoreRegistry;
