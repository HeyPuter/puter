// METADATA // {"ai-commented":{"service":"xai"}}
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
const { NodeInternalIDSelector, NodeUIDSelector } = require("../filesystem/node/selectors");
const { SiteActorType } = require("./auth/Actor");
const { PermissionUtil, PermissionRewriter, PermissionImplicator } = require("./auth/PermissionService");
const BaseService = require("./BaseService");
const { DB_WRITE } = require("./database/consts");


/**
* The `PuterSiteService` class manages site-related operations within the Puter platform. 
* This service extends `BaseService` to provide functionalities like:
* - Initializing database connections for site data.
* - Handling subdomain permissions and rewriting them as necessary.
* - Managing permissions for site files, ensuring that sites can access their own resources.
* - Retrieving subdomain information by name or unique identifier (UID).
* This class is crucial for controlling access and operations related to different sites hosted or managed by the Puter system.
*/
class PuterSiteService extends BaseService {
    /**
    * Initializes the PuterSiteService by setting up database connections, 
    * registering permission rewriters and implicators, and preparing service dependencies.
    * 
    * @returns {Promise<void>} A promise that resolves when initialization is complete.
    */
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
            id: 'in-site',
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


    /**
    * Retrieves subdomain information by its name.
    * 
    * @param {string} subdomain - The name of the subdomain to retrieve.
    * @returns {Promise<Object|null>} Returns an object with subdomain details or null if not found.
    * @note In development environment, 'devtest' subdomain returns hardcoded values.
    */
    async get_subdomain (subdomain, options) {
        if ( subdomain === 'devtest' && this.global_config.env === 'dev' ) {
            return {
                user_id: null,
                root_dir_id: this.config.devtest_directory,
            };
        }
        console.log('???', subdomain, options);
        const rows = await this.db.read(
            `SELECT * FROM subdomains WHERE ${
                options.is_custom_domain ? 'domain' : 'subdomain'
            } = ? LIMIT 1`,
            [subdomain]
        );
        if ( rows.length === 0 ) return null;
        return rows[0];
    }


    /**
    * Retrieves a subdomain by its unique identifier (UID).
    * 
    * @param {string} uid - The unique identifier of the subdomain to fetch.
    * @returns {Promise<Object|null>} A promise that resolves to the subdomain object if found, or null if not found.
    */
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
