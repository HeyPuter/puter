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
const { LocalDiskStorageStrategy } = require("../filesystem/strategies/storage_a/LocalDiskStorageStrategy");
const { TeePromise } = require("../util/promise");
const { progress_stream } = require("../util/streamutil");
const BaseService = require("./BaseService");

class LocalDiskStorageService extends BaseService {
    static MODULES = {
        fs: require('fs'),
        path: require('path'),
    }

    async ['__on_install.context-initializers'] () {
        const svc_contextInit = this.services.get('context-init');
        const storage = new LocalDiskStorageStrategy({ services: this.services });
        svc_contextInit.register_value('storage', storage);
    }

    async _init () {
        const require = this.require;
        const path_ = require('path');

        this.path = path_.join(process.cwd(), '/storage');

        // ensure directory exists
        const fs = require('fs');
        await fs.promises.mkdir(this.path, { recursive: true });
    }

    _get_path (key) {
        const require = this.require;
        const path = require('path');
        return path.join(this.path, key);
    }

    async store_stream ({ key, size, stream, on_progress }) {
        const require = this.require;
        const fs = require('fs');

        stream = progress_stream(stream, {
            total: size,
            progress_callback: on_progress,
        });

        const writePromise = new TeePromise();

        const path = this._get_path(key);
        const write_stream = fs.createWriteStream(path);
        write_stream.on('error', () => writePromise.reject());
        write_stream.on('finish', () => writePromise.resolve());

        stream.pipe(write_stream);

        return await writePromise;
    }

    async store_buffer ({ key, buffer }) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(key);
        await fs.promises.writeFile(path, buffer);
    }

    async create_read_stream ({ key }) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(key);
        return fs.createReadStream(path);
    }

    async copy ({ src_key, dst_key }) {
        const require = this.require;
        const fs = require('fs');

        const src_path = this._get_path(src_key);
        const dst_path = this._get_path(dst_key);

        await fs.promises.copyFile(src_path, dst_path);
    }

    async delete ({ key }) {
        const require = this.require;
        const fs = require('fs');

        const path = this._get_path(key);
        await fs.promises.unlink(path);
    }
}

module.exports = LocalDiskStorageService;
