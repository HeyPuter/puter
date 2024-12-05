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
const { Lock } = require('@heyputer/putility').libs.promise;

class SyncFeature {
    constructor (method_include_list) {
        this.method_include_list = method_include_list;
    }

    install_in_instance (instance) {
        for ( const method_name of this.method_include_list ) {
            const original_method = instance[method_name];
            const lock = new Lock();
            instance[method_name] = async (...args) => {
                return await lock.acquire(async () => {
                    return await original_method.call(instance, ...args);
                });
            }
        }
    }
}

module.exports = {
    SyncFeature,
};
