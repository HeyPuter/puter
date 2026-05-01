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

import { HttpError } from '../../core/http/HttpError.js';
import { PuterController } from '../types.js';

/**
 * Site hosting endpoints. Listing and create/update are not exposed as
 * controller routes — clients use the `puter-subdomains` driver
 * (select / create / update / read) so they get the v1-shape with
 * uuids and nested objects (no raw mysql ids). Only `/delete-site`
 * lives here because v1 also exposed it as a top-level POST.
 */
export class HostingController extends PuterController {
    constructor(config, clients, stores, services) {
        super(config, clients, stores, services);
    }

    get subdomainStore() {
        return this.stores.subdomain;
    }

    registerRoutes(router) {
        // ── Delete site ─────────────────────────────────────────────

        router.post(
            '/delete-site',
            {
                subdomain: 'api',
                requireUserActor: true,
                requireVerified: true,
            },
            async (req, res) => {
                const { site_uuid } = req.body ?? {};
                if (!site_uuid || typeof site_uuid !== 'string') {
                    throw new HttpError(400, 'Missing or invalid `site_uuid`');
                }

                const row = await this.subdomainStore.getByUuid(site_uuid, {
                    userId: req.actor.user.id,
                });
                if (!row) {
                    throw new HttpError(
                        404,
                        'Site not found or not owned by you',
                    );
                }
                if (row.protected) {
                    throw new HttpError(
                        403,
                        'Cannot delete a protected subdomain',
                    );
                }

                await this.subdomainStore.deleteByUuid(site_uuid, {
                    userId: req.actor.user.id,
                });

                res.json({});
            },
        );
    }

    onServerStart() {}
    onServerPrepareShutdown() {}
    onServerShutdown() {}
}
