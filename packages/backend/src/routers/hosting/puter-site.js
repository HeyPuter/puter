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
const { AdvancedBase } = require("@heyputer/puter-js-common");
const api_error_handler = require("../../api/api_error_handler");
const config = require("../../config");
const { get_user, get_app, id2path } = require("../../helpers");
const { Context } = require("../../util/context");
const { NodeInternalIDSelector, NodePathSelector } = require("../../filesystem/node/selectors");
const { TYPE_DIRECTORY } = require("../../filesystem/FSNodeContext");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const { Actor, UserActorType } = require("../../services/auth/Actor");
const APIError = require("../../api/APIError");

class PuterSiteMiddleware extends AdvancedBase {
    static MODULES = {
        path: require('path'),
        mime: require('mime-types'),
    }
    install (app) {
        app.use(this.run.bind(this));
    }
    async run (req, res, next) {
        if (
            ! req.hostname.endsWith(config.static_hosting_domain)
            && ( req.subdomains[0] !== 'devtest' )
        ) return next();

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
            req.subdomains[0] === 'devtest' ? 'devtest' :
            req.hostname.slice(0, -1 * (config.static_hosting_domain.length + 1));

        let path = (req.baseUrl + req.path) || 'index.html';

        const context = Context.get();
        const services = context.get('services');

        const svc_puterSite = services.get('puter-site');
        const site = await svc_puterSite.get_subdomain(subdomain);
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

            subdomain_root_path = await node.get('path');
        }

        if ( ! subdomain_root_path || subdomain_root_path === '/' ) {
            throw new APIError.create('forbidden');
        }

        const filepath = subdomain_root_path + decodeURIComponent(
            resolved_url_path
        );

        const target_node = await svc_fs.node(new NodePathSelector(filepath));
        await target_node.fetchEntry();

        if ( ! await target_node.exists() ) {
            return this.respond_index_not_found_(path, req, res, next);
        }

        const target_is_dir = await target_node.get('type') === TYPE_DIRECTORY;

        if ( target_is_dir && ! resolved_url_path.endsWith('/') ) {
            return res.redirect(resolved_url_path + '/');
        }

        if ( target_is_dir ) {
            return this.respond_index_not_found_(path, req, res, next);
        }

        const contentType = this.modules.mime.contentType(
            await target_node.get('name')
        );
        res.set('Content-Type', contentType);

        const ll_read = new LLRead();
        const stream = await ll_read.run({
            no_acl: true,
            actor: new Actor({
                user_uid: req.user ? req.user.uuid : null,
                type: new UserActorType({ user: req.user }),
            }),
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

    respond_index_not_found_ (path, req, res, next) {
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
            if(path === '/index.html')
                res.write('<code>index.html</code> Not Found');
            else
                res.write('Not Found');
        res.write(`</p>`)

        res.write('</div>');

        return res.end();
    }
}

module.exports = app => {
    const mw = new PuterSiteMiddleware();
    mw.install(app);
};
