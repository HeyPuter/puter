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
const { AdvancedBase } = require('@heyputer/putility');
const { quot } = require('@heyputer/putility').libs.string;

class ConfigLoader extends AdvancedBase {
    static MODULES = {
        path_: require('path'),
        fs: require('fs'),
    };

    constructor (logger, path, config) {
        super();
        this.logger = logger;
        this.path = path;
        this.config = config;
    }

    enable (name, meta = {}) {
        const { path_, fs } = this.modules;

        const config_path = path_.join(this.path, name);

        if ( ! fs.existsSync(config_path) ) {
            throw new Error(`Config file not found: ${config_path}`);
        }

        const config_values = JSON.parse(fs.readFileSync(config_path, 'utf8'));
        if ( config_values.$requires ) {
            const config_list = config_values.$requires;
            delete config_values.$requires;
            this.apply_requires(this.path, config_list, { by: name });
        }
        this.logger.debug(`Applying config: ${path_.relative(this.path, config_path)}${
            meta.by ? ` (required by ${meta.by})` : ''}`);
        this.config.load_config(config_values);

    }

    apply_requires (dir, config_list, { by } = {}) {
        const { path_, fs } = this.modules;

        for ( const name of config_list ) {
            const config_path = path_.join(dir, name);
            if ( ! fs.existsSync(config_path) ) {
                throw new Error(`could not find ${quot(config_path)} ` +
                    `required by ${quot(by)}`);
            }
            this.enable(name, { by });
        }
    }
}

module.exports = { ConfigLoader };