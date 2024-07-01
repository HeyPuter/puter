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
const { Context } = require("../util/context");
const BaseService = require("./BaseService");

class RefreshAssociationsService extends BaseService {
    async ['__on_boot.consolidation'] () {
        const { refresh_associations_cache } = require('../helpers');

        await Context.allow_fallback(async () => {
            refresh_associations_cache();
        });
        setTimeout(() => {
            setInterval(async () => {
                await Context.allow_fallback(async () => {
                    await refresh_associations_cache();
                })
            }, 30000);
        }, 15000)
    }
}

module.exports = { RefreshAssociationsService };
