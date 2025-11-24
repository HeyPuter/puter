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
const { Context } = require('../util/context');

module.exports = function SimpleEntity ({ name, methods, fetchers }) {
    const create = function (values) {
        const entity = { values };
        Object.assign(entity, methods);
        for ( const fetcher_name in fetchers ) {
            entity[`fetch_${ fetcher_name}`] = async function () {
                if ( this.values.hasOwnProperty(fetcher_name) ) {
                    return this.values[fetcher_name];
                }
                const value = await fetchers[fetcher_name].call(this);
                this.values[fetcher_name] = value;
                return value;
            };
        }
        entity.context = values.context ?? Context.get();
        entity.services = entity.context.get('services');
        return entity;
    };

    create.name = name;
    return create;
};
