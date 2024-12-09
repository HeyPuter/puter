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
"use strict"
const express = require('express');
const config = require('../config');
const router = express.Router();
const _path = require('path');
const _fs = require('fs');
const { Context } = require('../util/context');
const { DB_READ } = require('../services/database/consts');
const { PathBuilder } = require('../util/pathutil.js');

let auth_user;

// Helper function to safely handle metadata parsing
const parseMetadata = (metadata) => {
    try {
      // If metadata is null or undefined, return empty object
      if (!metadata) {
        return {};
      }
      
      // If metadata is already an object, return it
      if (typeof metadata === 'object' && !Array.isArray(metadata)) {
        return metadata;
      }
      
      // If metadata is a string, try to parse it
      if (typeof metadata === 'string') {
        return JSON.parse(metadata);
      }
      
      // If we get here, metadata is of an unexpected type
      console.warn('Unexpected metadata type:', typeof metadata);
      return {};
    } catch (error) {
      console.error('Error parsing metadata:', error);
      return {};
    }
};

// -----------------------------------------------------------------------//
// All other requests
// -----------------------------------------------------------------------//
router.all('*', async function(req, res, next) {
    const subdomain = req.hostname.slice(0, -1 * (config.domain.length + 1));
    let path = req.params[0] ? req.params[0] : 'index.html';

    // --------------------------------------
    // API
    // --------------------------------------
    if( subdomain === 'api'){
        return next();
    }
    // --------------------------------------
    // cloud.js must be accessible globally regardless of subdomain
    // --------------------------------------
    else if (path === '/cloud.js') {
        return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'puter.js/alpha.js'), function (err) {
            if (err && err.statusCode) {
                return res.status(err.statusCode).send('Error /cloud.js')
            }
        });
    }
    // --------------------------------------
    // /puter.js/v1 must be accessible globally regardless of subdomain
    // --------------------------------------
    else if (path === '/puter.js/v1' || path === '/puter.js/v1/') {
        return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'puter.js/v1.js'), function (err) {
            if (err && err.statusCode) {
                return res.status(err.statusCode).send('Error /puter.js')
            }
        });
    }
    else if (path === '/puter.js/v2' || path === '/puter.js/v2/') {
        return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'puter.js/v2.js'), function (err) {
            if (err && err.statusCode) {
                return res.status(err.statusCode).send('Error /puter.js')
            }
        });
    }
    // --------------------------------------
    // https://js.[domain]/v1/
    // --------------------------------------
    else if( subdomain === 'js'){
        if (path === '/v1' || path === '/v1/') {
            return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'puter.js/v1.js'), function (err) {
                if (err && err.statusCode) {
                    return res.status(err.statusCode).send('Error /puter.js')
                }
            });
        }
        if (path === '/v2' || path === '/v2/') {
            return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'puter.js/v2.js'), function (err) {
                if (err && err.statusCode) {
                    return res.status(err.statusCode).send('Error /puter.js')
                }
            });
        }
        if (path === '/putility/v1') {
            return res.sendFile(_path.join(__dirname, config.defaultjs_asset_path, 'putility.js/v1.js'), function (err) {
                if (err && err.statusCode) {
                    return res.status(err.statusCode).send('Error /putility.js')
                }
            });
        }
    }

    const db = Context.get('services').get('database').get(DB_READ, 'default');

    // --------------------------------------
    // POST to login/signup/logout
    // --------------------------------------
    if( subdomain === '' && req.method === 'POST' &&
        (
            path === '/login' ||
            path === '/signup' ||
            path === '/logout' ||
            path === '/send-pass-recovery-email' ||
            path === '/set-pass-using-token'
        )
    ){
        return next();
    }
    // --------------------------------------
    // No subdomain: either GUI or landing pages
    // --------------------------------------
    else if( subdomain === ''){
        // auth
        const {jwt_auth, get_app, invalidate_cached_user} = require('../helpers');
        let authed = false;
        try{
            try{
                auth_user = await jwt_auth(req);
                auth_user = auth_user.user;
                authed = true;
            }catch(e){
                authed = false;
            }
        }
        catch(e){
            authed = false;
        }

        if(path === '/robots.txt'){
            res.set('Content-Type', 'text/plain');
            let r = ``;
            r += `User-agent: AhrefsBot\nDisallow:/\n\n`;
            r += `User-agent: BLEXBot\nDisallow: /\n\n`;
            r += `User-agent: DotBot\nDisallow: /\n\n`;
            r += `User-agent: ia_archiver\nDisallow: /\n\n`;
            r += `User-agent: MJ12bot\nDisallow: /\n\n`;
            r += `User-agent: SearchmetricsBot\nDisallow: /\n\n`;
            r += `User-agent: SemrushBot\nDisallow: /\n\n`;
            // sitemap
            r += `\nSitemap: ${config.protocol}://${config.domain}/sitemap.xml\n`;
            return res.send(r);
        }
        else if(path === '/sitemap.xml'){
            let h = ``;
            h += `<?xml version="1.0" encoding="UTF-8"?>`;
            h += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`;

            // docs
            h += `<url>`;
                h += `<loc>${config.protocol}://docs.${config.domain}/</loc>`;
            h += `</url>`;

            // apps
            // TODO: use service for app discovery
            let apps = await db.read( `SELECT * FROM apps WHERE approved_for_listing = 1`);
            if(apps.length > 0){
                for(let i=0; i<apps.length; i++){
                    const app = apps[i];
                    h += `<url>`;
                        h += `<loc>${config.protocol}://${config.domain}/app/${app.name}</loc>`;
                    h += `</url>`;
                }
            }
            h += `</urlset>`;
            res.set('Content-Type', 'application/xml');
            return res.send(h);
        }
        else if(path === '/unsubscribe'){
            let h = `<body style="display:flex; flex-direction: column; justify-content: center; height: 100vh;">`;
            if(req.query.user_uuid === undefined)
                h += '<p style="text-align:center; color:red;">user_uuid is required</p>';
            else{
                // modules
                const {get_user} = require('../helpers')

                // get user
                const user = await get_user({uuid: req.query.user_uuid})

                // more validation
                if(!user)
                    h += '<p style="text-align:center; color:red;">User not found.</p>';
                else if(user.unsubscribed === 1)
                    h += '<p style="text-align:center; color:green;">You are already unsubscribed.</p>';
                // mark user as confirmed
                else{
                    await db.write(
                        "UPDATE `user` SET `unsubscribed` = 1 WHERE id = ?",
                        [user.id]
                    );

                    invalidate_cached_user(user);

                    // return results
                    h += `<p style="text-align:center; color:green;">Your have successfully unsubscribed from all emails.</p>`;
                }
            }

            h += `</body>`;
            res.send(h);
        }
        else if(path === '/confirm-email-by-token'){
            let h = `<body style="display:flex; flex-direction: column; justify-content: center; height: 100vh;">`;
            if(req.query.user_uuid === undefined)
                h += '<p style="text-align:center; color:red;">user_uuid is required</p>';
            else if(req.query.token === undefined)
                h += '<p style="text-align:center; color:red;">token is required</p>';
            else{
                // modules
                const {get_user} = require('../helpers')

                // get user
                const user = await get_user({uuid: req.query.user_uuid, force: true})

                // more validation
                if(user === undefined || user === null || user === false)
                    h += '<p style="text-align:center; color:red;">user not found.</p>';
                else if(user.email_confirmed === 1)
                    h += '<p style="text-align:center; color:green;">Email already confirmed.</p>';
                else if(user.email_confirm_token !== req.query.token)
                    h += '<p style="text-align:center; color:red;">invalid token.</p>';
                // mark user as confirmed
                else{
                    // This IIFE is here to return early on conditions, and
                    // avoid further nested branching. This is a temporary
                    // solution; next time this code should be refactored.
                    await (async () => {
                        const svc_cleanEmail = req.services.get('clean-email');
                        const clean_email = svc_cleanEmail.clean(user.email);
                        // If other users have the same CONFIRMED email, display an error
                        const maybe_rows = await db.read(
                            `SELECT EXISTS(
                                SELECT 1 FROM user WHERE (email=? OR clean_email=?)
                                AND email_confirmed=1
                                AND password IS NOT NULL
                            ) AS email_exists`,
                            [user.email, clean_email]
                        );
                        if ( maybe_rows[0]?.email_exists ) {
                            // TODO: maybe display the username of that account
                            h += '<p style="text-align:center; color:red;">' +
                                'This email was confirmed on a different account.</p>';
                            return;
                        }

                        // If other users have the same unconfirmed email, revoke it
                        await db.write(
                            'UPDATE `user` SET `unconfirmed_change_email` = NULL, `change_email_confirm_token` = NULL WHERE `unconfirmed_change_email` = ?',
                            [user.email],
                        );

                        // update user
                        await db.write(
                            "UPDATE `user` SET `email_confirmed` = 1, `requires_email_confirmation` = 0 WHERE id = ?",
                            [user.id]
                        );
                        invalidate_cached_user(user);

                        // send realtime success msg to client
                        const svc_socketio = req.services.get('socketio');
                        svc_socketio.send({ room: user.id }, 'user.email_confirmed', {});

                        // return results
                        h += `<p style="text-align:center; color:green;">Your email has been successfully confirmed.</p>`;

                        const svc_event = req.services.get('event');
                        svc_event.emit('user.email-confirmed', {
                            user_uid: user.uuid,
                            email: user.email,
                        });
                    })();
                }
            }

            h += `</body>`;
            res.send(h);
        }
        // ------------------------
        // /assets/
        // ------------------------
        else if (path.startsWith('/assets/')) {
            path = PathBuilder.resolve(path);
            return res.sendFile(path, { root: __dirname + '../../public' }, function (err) {
                if (err && err.statusCode) {
                    return res.status(err.statusCode).send('Error /public/')
                }
            });
        }
        // ------------------------
        // GUI
        // ------------------------
        else{
            let canonical_url = config.origin + path;
            let app_name, app_title, app_description, app_icon, app_social_media_image;
            let launch_options = {
                on_initialized: []
            };

            // default title
            app_title = config.title;

            // /action/
            if(path.startsWith('/action/') || path.startsWith('/@')){
                path = '/';
            }
            // /settings
            else if(path.startsWith('/settings')){
                path = '/';
            }
            // /app/
            else if(path.startsWith('/app/')){
                app_name = path.replace('/app/', '');
                const app = await get_app({name: app_name});


                if(app){
                    // parse app metadata if available
                    app.metadata  = parseMetadata(app.metadata);
                    // set app attributes to be passed to the homepage service
                    app_title = app.title;
                    app_description = app.description;
                    app_icon = app.icon;
                    app_social_media_image = app.metadata?.social_image;
                }
                // 404 - Not found!
                else if(app_name){
                    app_title = app_name.charAt(0).toUpperCase() + app_name.slice(1);
                    res.status(404);
                }

                path = '/';
            }
            else if (path.startsWith('/show/')) {
                const filepath = path.slice('/show'.length);
                launch_options.on_initialized.push({
                    $: 'window-call',
                    fn_name: 'launch_app',
                    args: [{
                        name: 'explorer',
                        path: filepath,
                    }],
                });
                path = '/';
            }

            const manifest =
                _fs.existsSync(_path.join(config.assets.gui, 'puter-gui.json'))
                    ? (() => {
                        const text = _fs.readFileSync(_path.join(config.assets.gui, 'puter-gui.json'), 'utf8');
                        return JSON.parse(text);
                    })()
                    : {};

            // index.js
            if(path === '/'){
                const svc_puterHomepage = Context.get('services').get('puter-homepage');
                return svc_puterHomepage.send({ req, res }, {
                    title: app_title,
                    description: app_description || config.short_description,
                    short_description: app_description || config.short_description,
                    social_media_image: app_social_media_image || config.social_media_image,
                    company: 'Puter Technologies Inc.',
                    canonical_url: canonical_url,
                    icon: app_icon,
                }, launch_options);
            }

            // /dist/...
            else if(path.startsWith('/dist/') || path.startsWith('/src/')){
                path = PathBuilder.resolve(path);
                return res.sendFile(path, {root: config.assets.gui}, function(err){
                    if(err && err.statusCode){
                        return res.status(err.statusCode).send('Error /gui/dist/')
                    }
                });
            }

            // All other paths
            else{
                path = PathBuilder.resolve(path);
                return res.sendFile(path, {root: _path.join(config.assets.gui, 'src')}, function(err){
                    if(err && err.statusCode){
                        return res.status(err.statusCode).send('Error /gui/')
                    }
                });
            }
        }
    }
    // --------------------------------------
    // Native Apps
    // --------------------------------------
    else if(subdomain === 'viewer' || subdomain === 'editor' ||  subdomain === 'about' || subdomain === 'docs' ||
            subdomain === 'player' || subdomain === 'pdf' || subdomain === 'code' || subdomain === 'markus' ||
            subdomain === 'draw' || subdomain === 'camera' || subdomain === 'recorder' ||
            subdomain === 'dev-center' || subdomain === 'terminal' || subdomain === 'developer'){

        let root = PathBuilder
            .add(__dirname)
            .add(config.defaultjs_asset_path, { allow_traversal: true })
            .add('apps').add(subdomain)
            .build();
        const has_dist = ['docs', 'developer'];
        if ( has_dist.includes(subdomain) ) {
            root += '/dist';
        }
        root = _path.normalize(root);

        path = _path.normalize(path);
        const real_path = _path.normalize(_path.join(root, path));

        // Determine if the path is a directory
        // (necessary because otherwise res.sendFile() will HANG!)
        try {
            const is_dir = (await _fs.promises.stat(real_path)).isDirectory();
            if ( is_dir && ! path.endsWith('/') ) {
                // Redirect to directory (use 307 to avoid browser caching)
                path += '/';
                let redirect_url = req.protocol + '://' + req.get('host') + path;

                // We need to add the query string to the redirect URL
                if ( req.query ) {
                    const old_url = req.protocol + '://' + req.get('host') + req.originalUrl;
                    redirect_url += new URL(old_url).search;
                }

                return res.redirect(307, redirect_url);
            }
        } catch (e) {
            console.error(e);
            return res.status(404).send('Not found');
        }

        console.log('sending path', path, 'from', root);
        try {
            return res.sendFile(path, { root }, function(err){
                if(err && err.statusCode){
                    return res.status(err.statusCode).send('Error /apps/')
                }
            });
        } catch (e) {
            console.error('error from sendFile', e);
            return res.status(e.statusCode).send('Error /apps/')
        }
    }
    // --------------------------------------
    // WWW, redirect to root domain
    // --------------------------------------
    else if( subdomain === 'www'){
        console.log('redirecting from www to root domain');
        return res.redirect(config.origin);
    }
    //------------------------------------------
    // User-defined subdomains: *.puter.com
    // redirect to static hosting domain *.puter.site
    //------------------------------------------
    else{
        // replace hostname with static hosting domain and redirect to the same path
        return res.redirect(301, req.protocol + '://' + req.get('host').replace(config.domain, config.static_hosting_domain) + req.originalUrl);
    }
});

module.exports = router
