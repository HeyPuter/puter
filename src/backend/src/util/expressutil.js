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
const eggspress = require("../api/eggspress");

const Endpoint = function Endpoint (spec, handler) {
    return {
        attach (route) {
            const eggspress_options = {
                allowedMethods: spec.methods ?? ['GET'],
                ...(spec.subdomain ? { subdomain: spec.subdomain } : {}),
                ...(spec.parameters ? { parameters: spec.parameters } : {}),
                ...(spec.alias ? { alias: spec.alias } : {}),
                ...(spec.mw ? { mw: spec.mw } : {}),
            };
            const eggspress_router = eggspress(
                spec.route,
                eggspress_options,
                handler ?? spec.handler,
            );
            route.use(eggspress_router);
        },
        but (newSpec) {
            // TODO: add merge with '$' behaviors (like config has)
            return Endpoint({
                ...spec,
                ...newSpec,
            });
        }
    };
}

module.exports = {
    Endpoint,
};
