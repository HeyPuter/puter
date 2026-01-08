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
const { NodePathSelector } = require('../../filesystem/node/selectors');
const configurable_auth = require('../../middleware/configurable_auth');
const { Endpoint } = require('../../util/expressutil');
const BaseService = require('../BaseService');
const bcrypt = require('bcrypt');
const xmlparser = require('express-xml-bodyparser');
let davMethodMap;
let unsupportedMethodHandler;
let COOKIE_NAME = null;

const ROOT_WEB_DAV_RESPONSE_XML = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>/</D:displayname>
        <D:getlastmodified>Fri, 03 Jan 2025 10:30:45 GMT</D:getlastmodified>
        <D:creationdate>2025-01-03T10:30:45Z</D:creationdate>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getetag>"dav-folder-1735898444"</D:getetag>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
          <D:lockentry>
            <D:lockscope><D:shared/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>dav</D:displayname>
        <D:getlastmodified>Fri, 03 Jan 2025 10:30:45 GMT</D:getlastmodified>
        <D:creationdate>2025-01-03T10:30:45Z</D:creationdate>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:getetag>"dav-folder-1735898445"</D:getetag>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
          <D:lockentry>
            <D:lockscope><D:shared/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
        <D:lockdiscovery/>
        <D:ishidden>0</D:ishidden>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

class WebDAVService extends BaseService {
    async _construct () {
        davMethodMap = (await import ( './methodHandlers/methodMap.mjs')).davMethodMap;
        unsupportedMethodHandler = (await import('./methodHandlers/method.mjs')).unsupportedMethodHandler;
    }
    async _init () {
        const svc_web = this.services.get('web-server');
        svc_web.allow_undefined_origin(/^\/dav(\/.*)?$/);
    }
    #extractHeaderToken = ( headerToken = '' ) => {
        let headerLockToken = null;
        let prefix = null;
        const match = headerToken.match(/(.*)<(urn:uuid:[0-9a-fA-F-]{36})>/);
        if ( match ) {
            if ( match.length > 2 ) {
                headerLockToken = match[2];
                prefix = match[1].trim().slice( 1, -1); // Remove surrounding parentheses
            } else {
                headerLockToken = match[1];
            }
        }
        return { headerLockToken, prefix };
    };
    async authenticateWebDavUser ( username, password, _req, res ) {
        // Default implementation - you should override this method
        // Return null to reject authentication
        const svc_auth = this.services.get('auth');

        const user = await this.services
            .get('get-user')
            .get_user( { username: username, cached: false });
        let otpToken = null;
        let real_password = password;

        if ( username === '-token' ) {
            return await svc_auth.authenticate_from_token(password);
        }

        if ( user.otp_enabled ) {
            real_password = password.slice(0, -6);
            otpToken = password.slice(-6);
        }

        if ( await bcrypt.compare(real_password, user.password) ) {
            const { token } = await svc_auth.create_session_token(user);
            if ( user.otp_enabled ) {
                const svc_otp = this.services.get('otp');
                const ok = svc_otp.verify(user.username,
                                user.otp_secret,
                                otpToken);
                if ( ! ok ) {
                    return null;
                }
            }

            res.cookie(COOKIE_NAME, token, {
                sameSite: 'none',
                secure: true,
                httpOnly: true,
                maxAge: 34560000000, // 400 days, chrome maximum
            });
            return await svc_auth.authenticate_from_token(token);
        }
        return null;
    }
    async handleHttpBasicAuth ( actor, req, res ) {
        if ( actor ) {
            return actor;
        }
        // Check for Basic Authentication header
        const authHeader = req.headers.authorization;
        if ( authHeader && authHeader.startsWith('Basic ') ) {
            try {
                // Parse Basic auth credentials
                const base64Credentials = authHeader.split(' ')[1];
                const credentials = Buffer.from(base64Credentials,
                                'base64').toString( 'ascii');
                let [ username, ...password ] = credentials.split(':');
                password = password.join(':');

                // Call user's authentication function
                actor = await this.authenticateWebDavUser(username,
                                password,
                                req,
                                res);
                if ( ! actor ) {
                    // Authentication failed
                    res.set({
                        'WWW-Authenticate': 'Basic realm="WebDAV"',
                        DAV: '1, 2',
                        'MS-Author-Via': 'DAV',
                    });
                    res.status(401).end( 'Unauthorized');
                    return;
                } else {
                    return actor;
                }
            } catch ( _e ) {
                res.set({
                    'WWW-Authenticate': 'Basic realm="WebDAV"',
                    DAV: '1, 2',
                    'MS-Author-Via': 'DAV',
                });
                res.status(401).end( 'Unauthorized');
                return;
            }
        } else {
            // No credentials provided, send challenge
            res.set({
                'WWW-Authenticate': 'Basic realm="WebDAV"',
                DAV: '1, 2',
                'MS-Author-Via': 'DAV',
            });
            res.status(401).end( 'Unauthorized');
            return;
        }
    }
    async handleWebDavServer ( filePath, req, res ) {
        const svc_fs = this.services.get('filesystem');
        const fileNode = await svc_fs.node(new NodePathSelector(filePath));
        // Extract the UUID from the If header (e.g., If: (<urn:uuid:...>))
        const ifHeader = req.headers['if'];
        const { headerLockToken } = this.#extractHeaderToken(ifHeader);

        const methodHandler =
            davMethodMap[req.method] ?? unsupportedMethodHandler;

        methodHandler(req, res, filePath, fileNode, headerLockToken);
    }
    ['__on_install.routes'] ( _, { app } ) {
        COOKIE_NAME = this.global_config.cookie_name;

        const r_webdav = (() => {
            const express = require('express');
            return express.Router();
        } )();
        r_webdav.use(xmlparser());

        app.use('/dav', r_webdav);

        Endpoint({
            route: '/*',
            methods: [
                'PROPFIND',
                'PROPPATCH',
                'MKCOL',
                'GET',
                'HEAD',
                'POST',
                'PUT',
                'DELETE',
                'COPY',
                'MOVE',
                'LOCK',
                'UNLOCK',
                'OPTIONS',
            ],
            mw: [ configurable_auth({ optional: true }) ],
            /**
             *
             * @param {import("express").Request} req
             * @param {import("express").Response} res
             */
            handler: async ( req, res ) => {
                const svc_su = this.services.get('su');
                let actor = await this.handleHttpBasicAuth(req.actor, req, res);
                if ( ! actor ) {
                    return;
                }
                let filePath = decodeURIComponent(req.path);
                // Handle root path for WebDAV compatibility
                if ( filePath === '/' || filePath === '' ) {
                    filePath = '/'; // Keep as root for WebDAV
                }

                svc_su.sudo(actor, async () => {
                    this.handleWebDavServer(filePath, req, res);
                });
            },
        }).attach( r_webdav);

        const r_rootdav = (() => {
            const require = this.require;
            const express = require('express');
            return express.Router();
        } )();
        app.use('/', r_rootdav);
        Endpoint({
            route: '/*',
            methods: [ 'PROPFIND' ],
            mw: [ configurable_auth({ optional: true }) ],
            /**
             *
             * @param {import("express").Request} req
             * @param {import("express").Response} res
             */
            handler: async ( req, res ) => {
                const svc_su = this.services.get('su');

                let actor = await this.handleHttpBasicAuth(req.actor, req, res);
                if ( ! actor ) {
                    return;
                }

                if ( req.path !== '/' && !req.path.startsWith('/dav') ) {
                    return res.status(404).end( 'Not Found');
                }
                if ( req.path === '/dav' ) {
                    svc_su.sudo(actor, async () => {
                        this.handleWebDavServer('/', req, res);
                    });
                }

                // Set proper headers for WebDAV XML response
                res.set({
                    'Content-Type': 'application/xml; charset=utf-8',
                    DAV: '1, 2',
                    'MS-Author-Via': 'DAV',
                });

                res.status(207);
                res.end(ROOT_WEB_DAV_RESPONSE_XML);
            },
        }).attach( r_rootdav);
    }
}

module.exports = {
    WebDavFS: WebDAVService,
};
