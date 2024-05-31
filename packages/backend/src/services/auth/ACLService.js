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
const APIError = require("../../api/APIError");
const { NodePathSelector } = require("../../filesystem/node/selectors");
const { get_user } = require("../../helpers");
const { Context } = require("../../util/context");
const BaseService = require("../BaseService");
const { AppUnderUserActorType, UserActorType, Actor, SystemActorType, AccessTokenActorType } = require("./Actor");

class ACLService extends BaseService {
    async check (actor, resource, mode) {
        const ld = (Context.get('logdent') ?? 0) + 1;
        return await Context.get().sub({ logdent: ld }).arun(async () => {
            const result =  await this._check_fsNode(actor, resource, mode);
            if ( this.verbose ) console.log('LOGGING ACL CHECK', {
                actor, mode,
                // trace: (new Error()).stack,
                result,
            });
            return result;
        });
    }

    async _check_fsNode (actor, fsNode, mode) {
        const context = Context.get();

        actor = Actor.adapt(actor);

        if ( actor.type instanceof SystemActorType ) {
            return true;
        }

        const path_selector = fsNode.get_selector_of_type(NodePathSelector);
        if ( path_selector && path_selector.value === '/') {
            if (['list','see','read'].includes(mode)) {
                return true;
            }
            return false;
        }

        // Access tokens only work if the authorizer has permission
        if ( actor.type instanceof AccessTokenActorType ) {
            const authorizer = actor.type.authorizer;
            const authorizer_perm = await this._check_fsNode(authorizer, fsNode, mode);

            if ( ! authorizer_perm ) return false;
        }

        // Hard rule: if app-under-user is accessing appdata directory, allow
        if ( actor.type instanceof AppUnderUserActorType ) {
            const appdata_path = `/${actor.type.user.username}/AppData/${actor.type.app.uid}`;
            const svc_fs = await context.get('services').get('filesystem');
            const appdata_node = await svc_fs.node(new NodePathSelector(appdata_path));

            if (
                await appdata_node.exists() && (
                    await appdata_node.is(fsNode) ||
                    await appdata_node.is_above(fsNode)
                )
            ) {
                console.log('TRUE BECAUSE APPDATA')
                return true;
            }
        }

        // app-under-user only works if the user also has permission
        if ( actor.type instanceof AppUnderUserActorType ) {
            const user_actor = new Actor({
                type: new UserActorType({ user: actor.type.user }),
            });
            const user_perm = await this._check_fsNode(user_actor, fsNode, mode);

            if ( ! user_perm ) return false;
        }

        const svc_permission = await context.get('services').get('permission');

        const modes = this._higher_modes(mode);
        let perm_fsNode = fsNode;
        while ( ! await perm_fsNode.get('is-root') ) {
            for ( const mode of modes ) {
                const perm = await svc_permission.check(
                    actor,
                    `fs:${await perm_fsNode.get('uid')}:${mode}`
                );
                if ( perm ) {
                    // console.log('TRUE BECAUSE PERMISSION', perm)
                    // console.log(`fs:${await perm_fsNode.get('uid')}:${mode}`)
                    return true;
                }
            }
            perm_fsNode = await perm_fsNode.getParent();
        }

        return false;
    }

    async get_safe_acl_error (actor, resource, mode) {
        const can_see = await this.check(actor, resource, 'see');
        if ( ! can_see ) {
            return APIError.create('subject_does_not_exist');
        }

        return APIError.create('forbidden');
    }

    // TODO: DRY: Also in FilesystemService
    _higher_modes (mode) {
        // If you want to X, you can do so with any of [...Y]
        if ( mode === 'see' ) return ['see', 'list', 'read', 'write'];
        if ( mode === 'list' ) return ['list', 'read', 'write'];
        if ( mode === 'read' ) return ['read', 'write'];
        if ( mode === 'write' ) return ['write'];
    }
}

module.exports = {
    ACLService,
};
