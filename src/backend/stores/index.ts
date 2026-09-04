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

import { AppFeedbackStore } from './appFeedback/AppFeedbackStore.js';
import { AppStore } from './app/AppStore.js';
import { FSEntryStore } from './fs/FSEntryStore.js';
import { GroupStore } from './group/GroupStore.js';
import { DurableSubscriptionStore } from './events/DurableSubscriptionStore.js';
import { EventHandlerStore } from './events/EventHandlerStore.js';
import { EventSubscriptionStore } from './events/EventSubscriptionStore.js';
import { KvShareHandleStore } from './events/KvShareHandleStore.js';
import { PendingDeliveryStore } from './events/PendingDeliveryStore.js';
import { CreditHoldStore } from './metering/CreditHoldStore.js';
import { MeteringBufferStore } from './metering/MeteringBufferStore.js';
import { NotificationStore } from './notification/NotificationStore.js';
import { OIDCStore } from './oidc/OIDCStore.js';
import { PermissionStore } from './permission/PermissionStore.js';
import { S3ObjectStore } from './fs/S3ObjectStore.js';
import { SessionStore } from './session/SessionStore.js';
import { ShareStore } from './share/ShareStore.js';
import { SubdomainStore } from './subdomain/SubdomainStore.js';
import { PresenceStore } from './events/PresenceStore.js';
import { SystemKVStore } from './systemKv/SystemKVStore.js';
import { TeamStore } from './team/TeamStore.js';
import { UserBlockStore } from './userBlock/UserBlockStore.js';
import { UserStore } from './user/UserStore.js';
import type { IPuterStoreRegistry } from './types.js';

/**
 * Populate `IPuterStoreInstances` (declared in `./types`) with the concrete
 * types of built-in stores. Done via declaration merging instead of
 * `LayerInstances<typeof puterStores>` because every concrete store extends
 * `PuterStore`, whose `protected stores` field references this type — a direct
 * `typeof puterStores` lookup would self-cycle.
 */
declare module './types.js' {
    interface IPuterStoreInstances {
        kv: SystemKVStore;
        meteringBuffer: MeteringBufferStore;
        creditHold: CreditHoldStore;
        user: UserStore;
        app: AppStore;
        appFeedback: AppFeedbackStore;
        fsEntry: FSEntryStore;
        s3Object: S3ObjectStore;
        subdomain: SubdomainStore;
        notification: NotificationStore;
        share: ShareStore;
        group: GroupStore;
        team: TeamStore;
        permission: PermissionStore;
        session: SessionStore;
        oidc: OIDCStore;
        userBlock: UserBlockStore;
        eventSubscription: EventSubscriptionStore;
        durableSubscription: DurableSubscriptionStore;
        eventHandler: EventHandlerStore;
        kvShareHandle: KvShareHandleStore;
        pendingDelivery: PendingDeliveryStore;
        presence: PresenceStore;
    }
}

// Ordering matters: stores declared later see earlier ones as peers.
// PermissionStore depends on `kv`, so `kv` must come first.
// MeteringBufferStore sits in front of `kv` for metering counters, so it too
// has to come after it.
// UserStore / AppStore are leaves (db + redis only); sit early so other
// stores/services can lean on them for cached lookups.
// FSEntryStore depends on `kv` (pending-upload sessions live there).
// S3ObjectStore is a leaf (clients.s3 only).
// SessionStore / ShareStore / UserBlockStore are leaves — only use clients.db.
export const puterStores = {
    kv: SystemKVStore,
    meteringBuffer: MeteringBufferStore,
    creditHold: CreditHoldStore,
    user: UserStore,
    app: AppStore,
    appFeedback: AppFeedbackStore,
    fsEntry: FSEntryStore,
    s3Object: S3ObjectStore,
    subdomain: SubdomainStore,
    notification: NotificationStore,
    share: ShareStore,
    group: GroupStore,
    team: TeamStore,
    permission: PermissionStore,
    session: SessionStore,
    oidc: OIDCStore,
    userBlock: UserBlockStore,
    // Redis only, no peer stores.
    eventSubscription: EventSubscriptionStore,
    pendingDelivery: PendingDeliveryStore,
    // Writes through the Redis keyspace above, so it comes after it.
    durableSubscription: DurableSubscriptionStore,
    // Table only, and reads the subscription table for its dependent counts.
    eventHandler: EventHandlerStore,
    // Table only.
    kvShareHandle: KvShareHandleStore,
    // Writes presence rows through `kv`'s reserved-item path, so it follows it.
    presence: PresenceStore,
} satisfies IPuterStoreRegistry;
