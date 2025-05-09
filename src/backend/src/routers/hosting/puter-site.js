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
const { AdvancedBase } = require("@heyputer/putility");
const api_error_handler = require("../../modules/web/lib/api_error_handler");
const config = require("../../config");
const { get_user, get_app } = require("../../helpers");
const { Context } = require("../../util/context");
const { NodeInternalIDSelector, NodePathSelector } = require("../../filesystem/node/selectors");
const { TYPE_DIRECTORY } = require("../../filesystem/FSNodeContext");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const { Actor, UserActorType, SiteActorType } = require("../../services/auth/Actor");
const APIError = require("../../api/APIError");
const { PermissionUtil } = require("../../services/auth/PermissionService");
const { default: dedent } = require("dedent");

const AT_DIRECTORY_NAMESPACE = '4aa6dc52-34c1-4b8a-b63c-a62b27f727cf';

class PuterSiteMiddleware extends AdvancedBase {
    static MODULES = {
        path: require('path'),
        mime: require('mime-types'),
        uuidv5: require('uuid').v5,
    }
    install (app) {
        app.use(this.run.bind(this));
    }
    async run (req, res, next) {
        
        ! req.hostname.endsWith(config.static_hosting_domain)
        && ( req.subdomains[0] !== 'devtest' )
        
        const is_subdomain =
            req.hostname.endsWith(config.static_hosting_domain)
            ||
            req.subdomains[0] === 'devtest'
            ;

        if ( ! is_subdomain && ! req.is_custom_domain ) return next();

        res.setHeader('Access-Control-Allow-Origin', '*');

        try {
            const expected_ctx = req.ctx;
            const received_ctx = Context.get();

            if ( expected_ctx && ! received_ctx ) {
                await expected_ctx.arun(async () => {
                    await this.run_(req, res, next);
                });
            } else await this.run_(req, res, next);
        } catch ( e ) {
            // TODO: html_error_handler
            api_error_handler(e, req, res, next);
        }
    }
    async run_ (req, res, next) {
        const subdomain =
            req.is_custom_domain ? req.hostname :
            req.subdomains[0] === 'devtest' ? 'devtest' :
            req.hostname.slice(0, -1 * (config.static_hosting_domain.length + 1));

        let path = (req.baseUrl + req.path) || 'index.html';

        const context = Context.get();
        const services = context.get('services');
        
        const get_username_site = (async () => {
            if ( ! subdomain.endsWith('.at') ) return;
            const parts = subdomain.split('.');
            if ( parts.length !== 2 ) return;
            const username = parts[0];
            if ( ! username.match(config.username_regex) ) {
                return;
            }
            const svc_fs = services.get('filesystem');
            const index_node = await svc_fs.node(new NodePathSelector(
                `/${username}/Public/index.html`
            ));
            const node = await svc_fs.node(new NodePathSelector(
                `/${username}/Public`
            ));
            if ( ! await index_node.exists() ) return;

            return {
                name: username + '.at',
                uuid: this.modules.uuidv5(username, AT_DIRECTORY_NAMESPACE),
                root_dir_id: await node.get('mysql-id'),
            };
        })

        const site =
            await get_username_site() ||
            await (async () => {
                const svc_puterSite = services.get('puter-site');
                const site = await svc_puterSite.get_subdomain(subdomain, {
                    is_custom_domain: req.is_custom_domain,
                });
                return site;
            })();

        if ( site === null ) {
            return res.status(404).send('Subdomain not found');
        }

        const subdomain_owner = await get_user({ id: site.user_id });
        if ( subdomain_owner?.suspended ) {
            // This used to be "401 Account suspended", but this implies
            // the client user is suspended, which is not the case.
            // Instead we simply return 404, indicating that this page
            // doesn't exist without further specifying that the owner's
            // account is suspended. (the client user doesn't need to know)
            return res.status(404).send('Subdomain not found');
        }

        if (
            site.associated_app_id &&
            ! req.query['puter.app_instance_id'] &&
            ( path === '' || path.endsWith('/') )
        ) {
            console.log('ASSOC APP ID', site.associated_app_id);
            const app = await get_app({ id: site.associated_app_id });
            return res.redirect(`${config.origin}/app/${app.name}/`);
        }

        if ( path === '' ) path += '/index.html';
        else if ( path.endsWith('/') ) path += 'index.html';

        const resolved_url_path =
            this.modules.path.resolve('/', path);

        const svc_fs = services.get('filesystem');

        let subdomain_root_path = '';
        if ( site.root_dir_id !== null && site.root_dir_id !== undefined ) {
            const node = await svc_fs.node(
                new NodeInternalIDSelector('mysql', site.root_dir_id)
            );
            if ( ! await node.exists() ) {
                res.status(502).send('subdomain is pointing to deleted directory');
            }
            if ( await node.get('type') !== TYPE_DIRECTORY ) {
                res.status(502).send('subdomain is pointing to non-directory');
            }

            // Verify subdomain owner permission
            const subdomain_actor = Actor.adapt(subdomain_owner);
            const svc_acl = services.get('acl');
            if ( ! await svc_acl.check(subdomain_actor, node, 'read') ) {
                res.status(502).send('subdomain owner does not have access to directory');
                return;
            }

            subdomain_root_path = await node.get('path');
        }


        if ( ! subdomain_root_path ) {
            return this.respond_html_error_({
                html: dedent(`
                    Subdomain or site is not pointing to a directory.
                `),
            }, req, res, next);
        }

        if ( ! subdomain_root_path || subdomain_root_path === '/' ) {
            throw APIError.create('forbidden');
        }

        const filepath = subdomain_root_path + decodeURIComponent(
            resolved_url_path
        );

        const target_node = await svc_fs.node(new NodePathSelector(filepath));
        await target_node.fetchEntry();

        if ( ! await target_node.exists() ) {
            return this.respond_html_error_({ path }, req, res, next);
        }

        const target_is_dir = await target_node.get('type') === TYPE_DIRECTORY;

        if ( target_is_dir && ! resolved_url_path.endsWith('/') ) {
            return res.redirect(resolved_url_path + '/');
        }

        if ( target_is_dir ) {
            return this.respond_html_error_({ path }, req, res, next);
        }

        const contentType = this.modules.mime.contentType(
            await target_node.get('name')
        );
        res.set('Content-Type', contentType);
        
        const acl_config = {
            no_acl: true,
            actor: null,
        };
        
        if ( site.protected ) {
            const svc_auth = req.services.get('auth');
            
            const get_site_actor_from_token = async () => {
                const site_token = req.cookies['puter.site.token'];
                if ( ! site_token ) return;

                let failed = false;
                let site_actor;
                try {
                    site_actor =
                        await svc_auth.authenticate_from_token(site_token);
                } catch (e) {
                    failed = true;
                }

                if ( failed ) return;
                    
                if ( ! site_actor ) return;

                // security measure: if 'puter.site.token' is set
                //   to a different actor type, someone is likely
                //   trying to exploit the system.
                if ( ! (site_actor.type instanceof SiteActorType) ) {
                    return;
                }
                
                acl_config.actor = site_actor;
                
                // Refresh the token if it's been 30 seconds since
                // the last request
                if (
                    (Date.now() - site_actor.type.iat*1000)
                    >
                    1000*30
                ) {
                    const site_token = svc_auth.get_site_app_token({
                        site_uid: site.uuid,
                    });
                    res.cookie('puter.site.token', site_token);
                }
                
                return true;
            };
            
            const make_site_actor_from_app_token = async () => {
                const token = req.query['puter.auth.token'];

                acl_config.no_acl = false;
                
                if ( ! token ) {
                    const e = APIError.create('token_missing');
                    return this.respond_error_({ req, res, e });
                }
                
                const app_actor =
                    await svc_auth.authenticate_from_token(token);
                    
                const user_actor =
                    app_actor.get_related_actor(UserActorType);
                
                const svc_permission = req.services.get('permission');
                const perm = await (async () => {
                    if ( user_actor.type.user.id === site.user_id ) {
                        return {};
                    }
                        
                    const reading = await svc_permission.scan(
                        user_actor, `site:uid#${site.uuid}:access`
                    );
                    const options = PermissionUtil.reading_to_options(reading);
                    return options.length > 0;
                })();
                
                if ( ! perm ) {
                    const e = APIError.create('forbidden');
                    this.respond_error_({ req, res, e });
                    return false;
                }
                
                const site_actor = await Actor.create(SiteActorType, { site });
                acl_config.actor = site_actor;

                // This subdomain is allowed to keep the site actor token,
                // so we send it here as a cookie so other html files can
                // also load.
                const site_token = svc_auth.get_site_app_token({
                    site_uid: site.uuid,
                });
                res.cookie('puter.site.token', site_token);
                return true;
            }
            
            let ok = await get_site_actor_from_token();
            if ( ! ok ) {
                ok = await make_site_actor_from_app_token();
            }
            if ( ! ok ) return;

            Object.freeze(acl_config);
        }

        const ll_read = new LLRead();
        // const actor = Actor.adapt(req.user);
        console.log('what user?', req.user);
        console.log('what actor?', acl_config.actor);
        const stream = await ll_read.run({
            no_acl: acl_config.no_acl,
            actor: acl_config.actor,
            fsNode: target_node,
        });

        // Destroy the stream if the client disconnects
        req.on('close', () => {
            stream.destroy();
        });

        try {
            return stream.pipe(res);
        } catch (e) {
            return res.status(500).send('Error reading file: ' + e.message);
        }
    }

    respond_html_error_ ({ path, html }, req, res, next) {
        res.status(404);
        res.set('Content-Type', 'text/html; charset=UTF-8');
        res.write(`<div style="font-size: 20px;
        text-align: center;
        height: calc(100vh);
        display: flex;
        justify-content: center;
        flex-direction: column;">`);
        res.write('<h1 style="margin:0; color:#727272;">404</h1>');
        res.write(`<p style="margin-top:10px;">`)
        if ( path ) {
            if ( path === '/index.html' ) {
                res.write('<code>index.html</code> Not Found');
            } else {
                res.write('Not Found');
            }
        } else {
            res.write(html);
        }
        res.write(`</p>`)

        res.write('</div>');

        return res.end();
    }
    
    respond_error_ ({ req, res, e }) {
        if ( ! (e instanceof APIError) ) {
            // TODO: alarm here
            e = APIError.create('unknown_error');
        }
        
        res.redirect(`${config.origin}?${e.querystringize({
            ...(req.query['puter.app_instance_id'] ? {
                ['error_from_within_iframe']: true,
            } : {})
        })}`);
    }
}

module.exports = app => {
    const mw = new PuterSiteMiddleware();
    mw.install(app);
};
