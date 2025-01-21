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

const { stream_to_buffer } = require("../../../util/streamutil");

module.exports = class IconResult {
    constructor (o) {
        Object.assign(this, o);
    }

    async get_data_url () {
        if ( this.data_url ) {
            return this.data_url;
        } else {
            try {
                const buffer = await stream_to_buffer(this.stream);
                return `data:${this.mime};base64,${buffer.toString('base64')}`;
            } catch (e) {
                const svc_error = Context.get(undefined, {
                    allow_fallback: true,
                }).get('services').get('error');
                svc_error.report('IconResult:get_data_url', {
                    source: e,
                });
                // TODO: broken image icon here
                return `data:image/png;base64,${Buffer.from([]).toString('base64')}`;
            }
        }
    }
};
