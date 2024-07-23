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
const { Sequence } = require("../../codex/Sequence");
const { get_user } = require("../../helpers");
const { Actor, UserActorType } = require("../../services/auth/Actor");
const { PERMISSION_SCANNERS } = require("../../unstructured/permission-scanners");

module.exports = new Sequence([
    async function grant_if_system (a) {
        const reading = a.get('reading');
        const { actor } = a.values();
        if ( actor.type.user.username === 'system' ) {
            reading.push({
                $: 'option',
                source: 'implied',
                data: {}
            })
            return a.stop({});
        }
    },
    async function rewrite_permission (a) {
        let { permission } = a.values();
        permission = await a.icall('_rewrite_permission', permission);
        a.values({ permission });
    },
    async function explode_permission (a) {
        const { permission } = a.values();
        const permission_options =
            await a.icall('get_higher_permissions', permission);
        a.values({ permission_options });
    },
    async function run_scanners (a) {
        const scanners = PERMISSION_SCANNERS;
        const ps = [];
        for ( const scanner of scanners ) {
            ps.push(scanner.scan(a));
        }
        await Promise.all(ps);
    },
]);
