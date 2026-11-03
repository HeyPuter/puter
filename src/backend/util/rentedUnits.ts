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

import type { Actor } from '../core/actor.js';
import { HttpError } from '../core/http/HttpError.js';
import {
    RENTED_UNITS_PER_USER,
    limitFor,
} from '../controllers/events/limits.js';
import {
    actorPlanId,
    type SubscriptionMetering,
} from '../services/metering/enforcement.js';
import type { EventHandlerStore } from '../stores/events/EventHandlerStore.js';
import {
    WORKER_SUBDOMAIN_PREFIX,
    type SubdomainStore,
} from '../stores/subdomain/SubdomainStore.js';

export interface RentedUnitDeps {
    stores: {
        subdomain: Pick<SubdomainStore, 'countByUserIdAndPrefix'>;
        eventHandler: Pick<
            EventHandlerStore,
            | 'countUserScopesWithHandlersForUser'
            | 'countAppsWithHandlersForOwner'
        >;
    };
    metering: SubscriptionMetering | undefined;
}

/**
 * Refuse creating one more rented unit for a user already holding their plan's
 * cap of them. Call only where a unit is created: a redeploy or a publish into
 * an existing unit must never reach it.
 */
export const assertRentedUnitRoom = async (
    deps: RentedUnitDeps,
    actor: Actor,
): Promise<void> => {
    const userId = actor.user?.id;
    if (userId === undefined) return;
    const cap = limitFor(
        RENTED_UNITS_PER_USER,
        await actorPlanId(deps.metering, actor),
    );
    const [workers, scopes, owned] = await Promise.all([
        deps.stores.subdomain.countByUserIdAndPrefix(
            userId,
            WORKER_SUBDOMAIN_PREFIX,
        ),
        deps.stores.eventHandler.countUserScopesWithHandlersForUser(userId),
        deps.stores.eventHandler.countAppsWithHandlersForOwner(userId),
    ]);
    if (Number(workers) + scopes + owned >= cap)
        throw new HttpError(403, `Worker limit reached (max ${cap})`, {
            legacyCode: 'forbidden',
        });
};
