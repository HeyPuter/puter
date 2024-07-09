/*
 * Copyright (C) 2024 Puter Technologies Inc.
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

const Endpoint = function Endpoint (spec) {
    return {
        attach (route) {
            const eggspress_options = {
                allowedMethods: spec.methods ?? ['GET'],
                ...(spec.mw ? { mw: spec.mw } : {}),
            };
            const eggspress_router = eggspress(
                spec.route,
                eggspress_options,
                spec.handler,
            );
            route.use(eggspress_router);
        }
    };
}

module.exports = {
    Endpoint,
};
