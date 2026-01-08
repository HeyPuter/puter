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
import { Sequence } from '../../codex/Sequence.js';
import { UserActorType } from '../../services/auth/Actor.js';
import { PERMISSION_SCANNERS } from '../../unstructured/permission-scanners.js';

const permissionSequence =  new Sequence([
    async function grant_if_system (a) {
        const reading = a.get('reading');
        const { actor, permission_options } = a.values();
        if ( ! (actor.type instanceof UserActorType) ) {
            return;
        }
        if ( actor.type.user.username === 'system' ) {
            reading.push({
                $: 'option',
                key: 'sys',
                permission: permission_options[0],
                source: 'implied',
                by: 'system',
                data: {},
            });
            return a.stop({});
        }
    },
    async function rewrite_permission (a) {
        let { reading, permission_options } = a.values();
        for ( let i = 0 ; i < permission_options.length ; i++ ) {
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

        for ( let i = 0 ; i < permission_options.length ; i++ ) {
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
    async function handle_shortcuts (a) {
        const reading = a.get('reading');
        const { actor, permission_options } = a.values();

        const _permission_implicators = a.iget('_permission_implicators');

        for ( const permission of permission_options )
        {
            for ( const implicator of _permission_implicators ) {
                if ( ! implicator.options?.shortcut ) continue;

                // TODO: is it possible to DRY this with concurrent implicators in permission-scanners.js?
                if ( ! implicator.matches(permission) ) {
                    continue;
                }
                const implied = await implicator.check({
                    actor,
                    permission,
                });
                if ( implied ) {
                    reading.push({
                        $: 'option',
                        permission,
                        source: 'implied',
                        by: implicator.id,
                        data: implied,
                        ...((actor.type.user)
                            ? { holder_username: actor.type.user.username }
                            : {}),
                    });
                    if ( implicator.options?.shortcut ) {
                        a.stop();
                        return;
                    }
                }
            }
        }
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

export default permissionSequence;
