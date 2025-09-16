// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
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
const BaseService = require("./BaseService");
const { MemoryFSProvider } = require("../modules/puterfs/customfs/MemoryFSProvider");
const { Readable } = require("stream");

class MemoryStorageService extends BaseService {
    async _init () {
        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.set_storage(MemoryFSProvider.name, this);
    }

    async create_read_stream (uuid, options) {
        const memory_file = options?.memory_file;
        if ( ! memory_file ) {
            throw new Error('MemoryStorageService.create_read_stream: memory_file is required');
        }

        return Readable.from(memory_file.content);
    }
}

module.exports = MemoryStorageService;