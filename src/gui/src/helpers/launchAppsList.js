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

/**
 * Drop `/get-launch-apps` entries the viewer can no longer launch, preserving
 * order. The backend marks an unlaunchable entry with a `privateAccess`
 * decision of `hasAccess: false` and no usable `index_url` — a private app the
 * viewer lacks access to, or a puter-hosted app whose backing is gone.
 *
 * @param {object[]} apps
 * @returns {object[]}
 */
export function filterLaunchableApps (apps) {
    return (apps ?? []).filter(
        (app) => app && app.privateAccess?.hasAccess !== false,
    );
}
