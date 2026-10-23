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

import { makeActor } from '../../core/actor.js';
import type { UserRow } from '../../stores/user/UserStore.js';
import type { PermissionService } from '../permission/PermissionService.js';

/** Per-app consent for an app's notifications to go out as pushes. */
export const NOTIFICATIONS_PUSH_PERMISSION = 'notifications:push';

export interface PushConsentDeps {
    stores: {
        user: { getById: (id: number) => Promise<UserRow | null | undefined> };
        app: {
            getByUid: (
                uid: string,
            ) => Promise<{ id?: number | null } | null | undefined>;
        };
    };
    services: { permission: Pick<PermissionService, 'check'> };
}

/** Read on every send; Puter's own notifications have no app and skip it. */
export const hasPushConsent = async (
    deps: PushConsentDeps,
    userId: number,
    appUid: string,
): Promise<boolean> => {
    try {
        const user = await deps.stores.user.getById(userId);
        if (!user?.id) return false;
        const app = await deps.stores.app.getByUid(appUid);
        if (!app?.id) return false;
        // As the app for that user: only their grant to it can answer yes.
        const actor = makeActor({ user, app: { uid: appUid, id: app.id } });
        return await deps.services.permission.check(
            actor,
            NOTIFICATIONS_PUSH_PERMISSION,
        );
    } catch (err) {
        console.warn('[push] consent check failed', err);
        return false;
    }
};
