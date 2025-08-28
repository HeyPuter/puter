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

const BaseService = require("../../../services/BaseService");
const { MemoryFSProvider } = require("./MemoryFSProvider");

class MemoryFSService extends BaseService {
    async _init () {
        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.register_mounter('memoryfs', this.as('mounter'));
    }

    static IMPLEMENTS = {
        mounter: {
            async mount ({ path, options }) {
                const provider = new MemoryFSProvider(path);
                return provider;
            }
        }
    }
}

module.exports = {
    MemoryFSService,
};