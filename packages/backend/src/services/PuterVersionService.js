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
const { AdvancedBase } = require("puter-js-common");
const { NodeUIDSelector } = require("../filesystem/node/selectors");
const { get_user } = require("../helpers");
const { TeePromise } = require("../util/promise");
const { StreamBuffer } = require("../util/streamutil");

class PuterVersionService extends AdvancedBase {
    static MODULES = {
        _path: require('path'),
        fs: require('fs'),
        _exec: require('child_process').execSync,
        axios: require('axios'),
    }

    constructor ({ services, config }) {
        super();
        this.fs = services.get('filesystem');
        this.config = config;

        this._init({ config });
        this.ready_ = new TeePromise();
    }

    async _init ({ config }) {
        // this.node = await this.fs.node(new NodeUIDSelector(config.puter_hosted_data.puter_versions));
        // this.user = await get_user({ username: 'puter' });

        // await this._poll_versions({ config });

        // setInterval(async () => {
        //     await this._poll_versions({ config });
        // }, 60 * 1000);
    }

    // not used anymore - this was for getting version numbers from a file hosted on puter
    async _poll_versions ({ config }) {
        const resp = await this.modules.axios.get(
            config.puter_hosted_data.puter_versions
        );
        this.versions_ = resp.data.versions;
        this.ready_.resolve();
    }

    get_version () {
        let git_version;
        let deploy_timestamp;
        if ( this.config.env === 'dev' ) {
            // get commit hash from git
            git_version = this.modules._exec('git describe --tags', {
                cwd: this.modules._path.join(__dirname, '../../'),
                encoding: 'utf8',
            }).trim();
            deploy_timestamp = Date.now();
        } else {
            // get git version from file
            const path = this.modules._path.join(__dirname, '../../git_version');

            git_version = this.modules.fs.readFileSync(path, 'utf8').trim();
            deploy_timestamp = Number.parseInt((this.modules.fs.readFileSync(
                this.modules._path.join(__dirname, '../../deploy_timestamp'),
                'utf8'
            )).trim());
        }
        return {
            version: git_version,
            environment: this.config.env,
            location: this.config.server_id,
            deploy_timestamp,
        };
    }
}

module.exports = {
    PuterVersionService,
};