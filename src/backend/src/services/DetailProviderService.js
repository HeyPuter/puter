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
const BaseService = require("./BaseService")

/**
 * A generic service class for any service that enables registering
 * detail providers. A detail provider is a function that takes an
 * input object and uses its values to populate another object.
 */
class DetailProviderService extends BaseService {
    _construct () {
        this.providers_ = [];
    }

    register_provider (fn) {
        this.providers_.push(fn);
    }

    async get_details (context, out) {
        out = out || {};

        for (const provider of this.providers_) {
            await provider(context, out);
        }

        return out;
    }
}

module.exports = { DetailProviderService }
