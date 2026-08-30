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

import { createHash } from 'node:crypto';
import type { EventsWorkerResolver } from '../../clients/events/EventsWorkerInvokerClient.js';
import { WORKER_SUBDOMAIN_PREFIX } from '../../stores/subdomain/SubdomainStore.js';
import type { IConfig } from '../../types.js';

/**
 * How an app's events worker is addressed.
 *
 * The worker is an ordinary deployed worker: one per app, owned by the app's
 * owner, registered like any other. What makes it findable without a lookup
 * table is its name — derived from the app and its owner, so the deploy step
 * and this resolver each compute it rather than one telling the other.
 *
 * The owner's uuid is folded in so the name is not computable from the app uid
 * alone: worker names are first-come, and a name a stranger could precompute is
 * a name a stranger could squat before the owner's first publish.
 */

export const eventsWorkerName = (
    appUid: string,
    ownerUserUuid: string,
): string =>
    'evw-' +
    createHash('sha256')
        .update(`${appUid}:${ownerUserUuid}`, 'utf8')
        .digest('hex')
        .slice(0, 40);

/** The registry rows and config the resolver reads, and nothing more. */
export interface EventsWorkerAddressingDeps {
    config: IConfig;
    stores: {
        app: {
            getByUid(
                uid: string,
            ): Promise<{ owner_user_id?: unknown } | null | undefined>;
        };
        user: {
            getById(id: number): Promise<{ uuid: string } | null | undefined>;
        };
        subdomain: {
            getBySubdomain(subdomain: string): Promise<unknown | null>;
        };
    };
}

/**
 * Resolves an app's events worker to its invoke URL from the workers registry.
 *
 * `null` whenever any link is missing — no app, no owner, no deployed worker —
 * which the invoker reports as retriable: the address is the platform's to
 * provide, and publish is what provides it.
 */
export class DeployedEventsWorkerResolver implements EventsWorkerResolver {
    readonly #deps: EventsWorkerAddressingDeps;

    constructor(deps: EventsWorkerAddressingDeps) {
        this.#deps = deps;
    }

    async resolveInvokeUrl(appUid: string): Promise<string | null> {
        const { stores } = this.#deps;
        const app = await stores.app.getByUid(appUid);
        const ownerUserId = Number(app?.owner_user_id);
        if (!app || !Number.isFinite(ownerUserId)) return null;

        const owner = await stores.user.getById(ownerUserId);
        if (!owner?.uuid) return null;

        const name = eventsWorkerName(appUid, owner.uuid);
        const row = await stores.subdomain.getBySubdomain(
            `${WORKER_SUBDOMAIN_PREFIX}${name}`,
        );
        if (!row) return null;

        return this.#urlFor(name);
    }

    /**
     * Where a deployed worker answers. Mirrors what the deploy backends
     * advertise: the local dispatch host when workers run locally, the public
     * worker domain otherwise.
     */
    #urlFor(name: string): string {
        const { config } = this.#deps;
        if (config.workers?.localServer) {
            const port = config.port ? `:${config.port}` : '';
            return `http://${name}.workers.puter.localhost${port}`;
        }
        return `https://${name}.puter.work`;
    }
}
