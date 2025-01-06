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
const { is_valid_path } = require("../../filesystem/validation");
const { is_valid_uuid4 } = require("../../helpers");
const { Context } = require("../../util/context");
const { PathBuilder } = require("../../util/pathutil");
const APIError = require("../APIError");
const _path = require('path');

module.exports = class FSNodeParam {
    constructor (srckey, options) {
        this.srckey = srckey;
        this.options = options ?? {};
        this.optional = this.options.optional ?? false;
    }

    async consolidate ({ req, getParam }) {
        const log = globalThis.services.get('log-service').create('fsnode-param');
        const fs = Context.get('services').get('filesystem');

        let uidOrPath = getParam(this.srckey);
        if ( uidOrPath === undefined ) {
            if ( this.optional ) return undefined;
            throw APIError.create('field_missing', null, {
                key: this.srckey,
            });
        }

        if ( uidOrPath.length === 0 ) {
            if ( this.optional ) return undefined;
            APIError.create('field_empty', null, {
                key: this.srckey,
            });
        }

        if ( ! ['/','.','~'].includes(uidOrPath[0]) ) {
            if ( is_valid_uuid4(uidOrPath) ) {
                return await fs.node({ uid: uidOrPath });
            }

            log.debug('tried uuid', { uidOrPath })
            throw APIError.create('field_invalid', null, {
                key: this.srckey,
                expected: 'unix-style path or uuid4',
            });
        }

        if ( uidOrPath.startsWith('~') && req.user ) {
            const homedir = `/${req.user.username}`;
            uidOrPath = homedir + uidOrPath.slice(1);
        }

        if ( ! is_valid_path(uidOrPath) ) {
            log.debug('tried path', { uidOrPath })
            throw APIError.create('field_invalid', null, {
                key: this.srckey,
                expected: 'unix-style path or uuid4',
            });
        }

        const resolved_path = PathBuilder.resolve(uidOrPath, { puterfs: true });
        return await fs.node({ path: resolved_path });
    }
}