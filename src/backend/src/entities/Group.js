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
const SimpleEntity = require("../definitions/SimpleEntity");

module.exports = SimpleEntity({
    name: 'group',
    fetchers: {
        async members () {
            const svc_group = this.services.get('group');
            const members = await svc_group.list_members({ uid: this.values.uid });
            return members;
        }
    },
    methods: {
        async get_client_value (options = {}) {
            if ( options.members ) {
                await this.fetch_members();
            }
            const group = {
                uid: this.values.uid,
                metadata: this.values.metadata,
                ...(options.members ? { members: this.values.members } : {}),
            };
            return group;
        }
    }
});
