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
const { NodeInternalIDSelector, NodeUIDSelector } = require("../filesystem/node/selectors");
const { Context } = require("../util/context");
const { SiteActorType } = require("./auth/Actor");
const { PermissionUtil, PermissionRewriter, PermissionImplicator } = require("./auth/PermissionService");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");

class PuterSiteService extends BaseService {
    async _init () {
        const services = this.services;
        this.db = services.get('database').get(DB_WRITE, 'sites');
        
        const svc_fs = services.get('filesystem');

        // Rewrite site permissions specified by name
        const svc_permission = this.services.get('permission');
        svc_permission.register_rewriter(PermissionRewriter.create({
            matcher: permission => {
                if ( ! permission.startsWith('site:') ) return false;
                const [_, specifier] = PermissionUtil.split(permission);
                if ( specifier.startsWith('uid#') ) return false;
                return true;
            },
            rewriter: async permission => {
                const [_1, name, ...rest] = PermissionUtil.split(permission);
                const sd = await this.get_subdomain(name);
                return PermissionUtil.join(
                    _1, `uid#${sd.uuid}`, ...rest,
                );
            },
        }));
        
        // Imply that sites can read their own files
        svc_permission.register_implicator(PermissionImplicator.create({
            matcher: permission => {
                return permission.startsWith('fs:');
            },
            checker: async ({ actor, permission }) => {
                if ( !(actor.type instanceof SiteActorType) ) {
                    return undefined;
                }

                const [_, uid, lvl] = PermissionUtil.split(permission);
                const node = await svc_fs.node(new NodeUIDSelector(uid));
                
                if ( !['read','list','see'].includes(lvl) ) {
                    return undefined;
                }

                if ( ! await node.exists() ) {
                    return undefined;
                }
                
                const site_node = await svc_fs.node(
                    new NodeInternalIDSelector(
                        'mysql',
                        actor.type.site.root_dir_id,
                    )
                );
                
                if ( await site_node.is(node) ) {
                    return {};
                }
                if ( await site_node.is_above(node) ) {
                    return {};
                }

                return undefined;
            },
        }));
    }

    async get_subdomain (subdomain) {
        if ( subdomain === 'devtest' && this.global_config.env === 'dev' ) {
            return {
                user_id: null,
                root_dir_id: this.config.devtest_directory,
            };
        }
        const rows = await this.db.read(
            `SELECT * FROM subdomains WHERE subdomain = ? LIMIT 1`,
            [subdomain]
        );
        if ( rows.length === 0 ) return null;
        return rows[0];
    }

    async get_subdomain_by_uid (uid) {
        const rows = await this.db.read(
            `SELECT * FROM subdomains WHERE uuid = ? LIMIT 1`,
            [uid]
        );
        if ( rows.length === 0 ) return null;
        return rows[0];
    }
}

module.exports = {
    PuterSiteService,
};
