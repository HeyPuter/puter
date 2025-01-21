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
const { permission } = require("process");
const { Sequence } = require("../../codex/Sequence");
const { UserActorType } = require("../../services/auth/Actor");
const { PERMISSION_SCANNERS } = require("../../unstructured/permission-scanners");

module.exports = new Sequence([
    async function grant_if_system (a) {
        const reading = a.get('reading');
        const { actor, permission_options } = a.values();
        if ( !(actor.type instanceof UserActorType)  ) {
            return;
        }
        if ( actor.type.user.username === 'system' ) {
            reading.push({
                $: 'option',
                key: `sys`,
                permission: permission_options[0],
                source: 'implied',
                by: 'system',
                data: {}
            })
            return a.stop({});
        }
    },
    async function rewrite_permission (a) {
        let { reading, permission_options } = a.values();
        for ( let i=0 ; i < permission_options.length ; i++ ) {
            const old_perm = permission_options[i];
            const permission = await a.icall('_rewrite_permission', old_perm);
            if ( permission === old_perm ) continue;
            permission_options[i] = permission;
            reading.push({
                $: 'rewrite',
                from: old_perm,
                to: permission,
            });
        }
    },
    async function explode_permission (a) {
        let { reading, permission_options } = a.values();

        // VERY nasty bugs can happen if this array is not cloned!
        // (this was learned the hard way)
        permission_options = [...permission_options];

        for ( let i=0 ; i < permission_options.length ; i++ ) {
            const permission = permission_options[i];
            permission_options[i] =
                await a.icall('get_higher_permissions', permission);
            if ( permission_options[i].length > 1 ) {
                reading.push({
                    $: 'explode',
                    from: permission,
                    to: permission_options[i],
                });
            }
        }
        a.set('permission_options', permission_options.flat());
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
