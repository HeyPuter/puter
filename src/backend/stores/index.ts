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

import { AppStore } from './app/AppStore.js';
import { FSEntryStore } from './fs/FSEntryStore.js';
import { GroupStore } from './group/GroupStore.js';
import { NotificationStore } from './notification/NotificationStore.js';
import { OIDCStore } from './oidc/OIDCStore.js';
import { PermissionStore } from './permission/PermissionStore.js';
import { S3ObjectStore } from './fs/S3ObjectStore.js';
import { SessionStore } from './session/SessionStore.js';
import { ShareStore } from './share/ShareStore.js';
import { SubdomainStore } from './subdomain/SubdomainStore.js';
import { SystemKVStore } from './systemKv/SystemKVStore.js';
import { UserStore } from './user/UserStore.js';
import type { IPuterStoreRegistry } from './types.js';

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
    oidc: OIDCStore,
} satisfies IPuterStoreRegistry;
