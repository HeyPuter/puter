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
import dedent from 'dedent';
import { contentType as contentTypeFromMime } from 'mime-types';
import { resolve } from 'path';
import { v5 as uuidv5 } from 'uuid';
import APIError from '../../api/APIError.js';
import config from '../../config.js';
import fsNodeContext from '../../filesystem/FSNodeContext.js';
import llReadModule from '../../filesystem/ll_operations/ll_read.js';
import selectors from '../../filesystem/node/selectors.js';
import { get_app, get_user } from '../../helpers.js';
import api_error_handler from '../../modules/web/lib/api_error_handler.js';
import { Actor, SiteActorType, UserActorType } from '../../services/auth/Actor.js';
import { PermissionUtil } from '../../services/auth/permissionUtils.mjs';
import { Context } from '../../util/context.js';
import { stream_to_buffer as streamToBuffer } from '../../util/streamutil.js';
import {
    getSiteErrorRule,
    parseSiteErrorConfig,
} from './puter-site-config.js';

const {
    origin: originUrl,
    cookie_name: cookieName,
    private_app_hosting_domain: privateAppHostingDomain,
    static_hosting_base_domain_redirect: staticHostingBaseDomainRedirect,
    static_hosting_domain: staticHostingDomain,
    static_hosting_domain_alt: staticHostingDomainAlt,
    username_regex: usernameRegex,
} = config;
const { TYPE_DIRECTORY } = fsNodeContext;
const { LLRead } = llReadModule;
const {
    NodeInternalIDSelector,
    NodePathSelector,
} = selectors;

const AT_DIRECTORY_NAMESPACE = '4aa6dc52-34c1-4b8a-b63c-a62b27f727cf';
const puterSiteConfigFilename = '.puter_site_config';
const puterSiteConfigMaxSize = 256 * 1024;

function isPrivateApp (app) {
    return Number(app?.is_private ?? 0) > 0;
}

function hostMatchesPrivateDomain (hostname) {
    const privateHostingDomain = `${privateAppHostingDomain ?? 'puter.app'}`
        .trim()
        .toLowerCase()
        .replace(/^\./, '');
    if ( ! privateHostingDomain ) return false;

    const host = `${hostname ?? ''}`.trim().toLowerCase();
    if ( ! host ) return false;

    return host === privateHostingDomain || host.endsWith(`.${privateHostingDomain}`);
}

function buildPrivateHostRedirectUrl (req, app) {
    if ( !app?.index_url || typeof app.index_url !== 'string' ) {
        return null;
    }

    try {
        const redirectUrl = new URL(req.originalUrl || '/', app.index_url);
        return redirectUrl.toString();
    } catch {
        return null;
    }
}

function getPrivateDeniedRedirectUrl (app, denyRedirectUrl) {
    if ( typeof denyRedirectUrl === 'string' && denyRedirectUrl.trim() ) {
        return denyRedirectUrl.trim();
    }

    const origin = `${originUrl ?? ''}`.trim().replace(/\/$/, '');
    if ( origin ) {
        return `${origin}/app/app-center/?item=${encodeURIComponent(app?.uid ?? '')}`;
    }

    return '/';
}

function getTokenFromAuthorizationHeader (req) {
    const authorizationHeader = req.headers?.authorization;
    if ( typeof authorizationHeader !== 'string' ) return null;
    const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
}

function getBootstrapTokenFromReferrer (req) {
    const referrerHeader = req.headers?.referer ?? req.headers?.referrer;
    if ( typeof referrerHeader !== 'string' || !referrerHeader.trim() ) {
        return null;
    }

    try {
        const referrerUrl = new URL(referrerHeader);
        return referrerUrl.searchParams.get('puter.auth.token')
            || referrerUrl.searchParams.get('auth_token');
    } catch {
        return null;
    }
}

function getBootstrapPrivateToken (req) {
    const authorizationToken = getTokenFromAuthorizationHeader(req);
    if ( authorizationToken ) return authorizationToken;

    const queryToken = req.query?.['puter.auth.token'];
    if ( typeof queryToken === 'string' && queryToken.trim() ) {
        return queryToken.trim();
    }

    const headerToken = req.headers?.['x-puter-auth-token'];
    if ( typeof headerToken === 'string' && headerToken.trim() ) {
        return headerToken.trim();
    }

    return getBootstrapTokenFromReferrer(req);
}

function actorToPrivateIdentity (actor) {
    if ( ! actor ) return null;

    let userActor = null;
    if ( actor.type instanceof UserActorType ) {
        userActor = actor;
    } else {
        try {
            userActor = actor.get_related_actor(UserActorType);
        } catch {
            userActor = null;
        }
    }

    const userUid = userActor?.type?.user?.uuid;
    if ( typeof userUid !== 'string' || !userUid ) {
        return null;
    }

    const sessionCandidate = actor.type?.session ?? userActor.type?.session;
    const sessionUuid = typeof sessionCandidate === 'string'
        ? sessionCandidate
        : sessionCandidate?.uuid;

    return {
        userUid,
        sessionUuid: typeof sessionUuid === 'string' && sessionUuid ? sessionUuid : undefined,
    };
}

async function resolvePrivateIdentity ({ req, services, appUid }) {
    const authService = services.get('auth');
    const privateCookieName = authService.getPrivateAssetCookieName();
    const privateCookieToken = req.cookies?.[privateCookieName];

    if ( typeof privateCookieToken === 'string' && privateCookieToken ) {
        try {
            const claims = authService.verifyPrivateAssetToken(privateCookieToken, {
                expectedAppUid: appUid,
            });
            return {
                source: 'private-cookie',
                userUid: claims.userUid,
                sessionUuid: claims.sessionUuid,
                hasValidPrivateCookie: true,
            };
        } catch {
            // fallback to next token source
        }
    }

    const sessionToken = req.cookies?.[cookieName];
    if ( typeof sessionToken === 'string' && sessionToken ) {
        try {
            const actor = await authService.authenticate_from_token(sessionToken);
            const identity = actorToPrivateIdentity(actor);
            if ( identity ) {
                return {
                    source: 'session-cookie',
                    ...identity,
                    hasValidPrivateCookie: false,
                };
            }
        } catch {
            // fallback to next token source
        }
    }

    const bootstrapToken = getBootstrapPrivateToken(req);
    if ( typeof bootstrapToken === 'string' && bootstrapToken ) {
        try {
            const actor = await authService.authenticate_from_token(bootstrapToken);
            const identity = actorToPrivateIdentity(actor);
            if ( identity ) {
                return {
                    source: 'bootstrap-token',
                    ...identity,
                    hasValidPrivateCookie: false,
                };
            }
        } catch {
            // no valid identity from bootstrap token
        }
    }

    return {
        source: 'none',
        userUid: undefined,
        sessionUuid: undefined,
        hasValidPrivateCookie: false,
    };
}

async function evaluatePrivateAppAccess ({ req, res, services, app, requestPath }) {
    const eventService = services.get('event');
    const identity = await resolvePrivateIdentity({
        req,
        services,
        appUid: app.uid,
    });

    const accessCheckEvent = {
        appUid: app.uid,
        userUid: identity.userUid ?? null,
        requestHost: req.hostname,
        requestPath,
        result: {
            allowed: false,
        },
    };

    try {
        await eventService.emit('app.privateAccess.check', accessCheckEvent);
    } catch (e) {
        console.error('private app access check failed', e);
    }

    if ( ! accessCheckEvent.result.allowed ) {
        const redirectUrl = getPrivateDeniedRedirectUrl(
            app,
            accessCheckEvent.result.redirectUrl,
        );
        res.redirect(redirectUrl);
        return false;
    }

    if ( identity.userUid && !identity.hasValidPrivateCookie ) {
        const authService = services.get('auth');
        const privateToken = authService.createPrivateAssetToken({
            appUid: app.uid,
            userUid: identity.userUid,
            sessionUuid: identity.sessionUuid,
        });
        res.cookie(
            authService.getPrivateAssetCookieName(),
            privateToken,
            authService.getPrivateAssetCookieOptions(),
        );
    }

    return true;
}

async function runInternal (req, res, next) {
    const subdomain =
        req.is_custom_domain ? req.hostname :
            req.subdomains[0] === 'devtest' ? 'devtest' :
                req.hostname.split('.')[0];

    let path = (req.baseUrl + req.path) || 'index.html';

    const context = Context.get();
    const services = context.get('services');

    const getUsernameSite = (async () => {
        if ( ! subdomain.endsWith('.at') ) return;
        const parts = subdomain.split('.');
        if ( parts.length !== 2 ) return;
        const username = parts[0];
        if ( ! username.match(usernameRegex) ) {
            return;
        }
        const filesystemService = services.get('filesystem');
        const indexNode = await filesystemService.node(new NodePathSelector(`/${username}/Public/index.html`));
        const node = await filesystemService.node(new NodePathSelector(`/${username}/Public`));
        if ( ! await indexNode.exists() ) return;

        return {
            name: `${username }.at`,
            uuid: uuidv5(username, AT_DIRECTORY_NAMESPACE),
            root_dir_id: await node.get('mysql-id'),
        };
    });

    if ( req.hostname === staticHostingDomain || req.hostname === staticHostingDomainAlt || subdomain === 'www' ) {

        // redirect to information page about static hosting
        return res.redirect(staticHostingBaseDomainRedirect);
    }

    const site =
        await getUsernameSite() ||
        await (async () => {
            const puterSiteService = services.get('puter-site');
            const site = await puterSiteService.get_subdomain(subdomain, {
                is_custom_domain: req.is_custom_domain,
            });
            return site;
        })();

    if ( site === null ) {
        return res.status(404).send('Subdomain not found');
    }

    const subdomainOwner = await get_user({ id: site.user_id });
    if ( subdomainOwner?.suspended ) {
        // This used to be "401 Account suspended", but this implies
        // the client user is suspended, which is not the case.
        // Instead we simply return 404, indicating that this page
        // doesn't exist without further specifying that the owner's
        // account is suspended. (the client user doesn't need to know)
        return res.status(404).send('Subdomain not found');
    }

    const associatedApp = site.associated_app_id
        ? await get_app({ id: site.associated_app_id })
        : null;
    const privateAppEnabled = isPrivateApp(associatedApp);

    if ( privateAppEnabled && !hostMatchesPrivateDomain(req.hostname) ) {
        const privateHostRedirect = buildPrivateHostRedirectUrl(req, associatedApp);
        if ( privateHostRedirect ) {
            return res.redirect(privateHostRedirect);
        }
        return res.status(403).send('Private app host mismatch');
    }

    if (
        site.associated_app_id &&
        !req.query['puter.app_instance_id'] &&
        ( path === '' || path.endsWith('/') )
    ) {
        const app = associatedApp || await get_app({ id: site.associated_app_id });
        return res.redirect(`${originUrl}/app/${app.name}/`);
    }

    if ( path === '' ) path += '/index.html';
    else if ( path.endsWith('/') ) path += 'index.html';

    const resolvedUrlPath =
        resolve('/', path);

    const filesystemService = services.get('filesystem');

    let subdomainRootPath = '';
    if ( site.root_dir_id !== null && site.root_dir_id !== undefined ) {
        const node = await filesystemService.node(new NodeInternalIDSelector('mysql', site.root_dir_id));
        if ( ! await node.exists() ) {
            return res.status(502).send('subdomain is pointing to deleted directory');
        }
        if ( await node.get('type') !== TYPE_DIRECTORY ) {
            return res.status(502).send('subdomain is pointing to non-directory');
        }

        // Verify subdomain owner permission
        const subdomainActor = Actor.adapt(subdomainOwner);
        const aclService = services.get('acl');
        if ( ! await aclService.check(subdomainActor, node, 'read') ) {
            res.status(502).send('subdomain owner does not have access to directory');
            return;
        }

        subdomainRootPath = await node.get('path');
    }

    if ( ! subdomainRootPath ) {
        return respondHtmlError({
            html: dedent(`
                    Subdomain or site is not pointing to a directory.
                `),
        }, req, res, next);
    }

    if ( !subdomainRootPath || subdomainRootPath === '/' ) {
        throw APIError.create('forbidden');
    }

    req.__puterSiteRootPath = subdomainRootPath;

    if ( privateAppEnabled ) {
        const accessAllowed = await evaluatePrivateAppAccess({
            req,
            res,
            services,
            app: associatedApp,
            requestPath: req.path,
        });
        if ( ! accessAllowed ) return;
    }

    const filepath = subdomainRootPath + decodeURIComponent(resolvedUrlPath);

    const targetNode = await filesystemService.node(new NodePathSelector(filepath));
    await targetNode.fetchEntry();

    if ( ! await targetNode.exists() ) {
        return await respond404({ path }, req, res, next, subdomainRootPath);
    }

    const targetIsDir = await targetNode.get('type') === TYPE_DIRECTORY;

    if ( targetIsDir && !resolvedUrlPath.endsWith('/') ) {
        return res.redirect(`${resolvedUrlPath }/`);
    }

    if ( targetIsDir ) {
        return await respond404({ path }, req, res, next, subdomainRootPath);
    }

    const contentType = contentTypeFromMime(await targetNode.get('name'));
    res.set('Content-Type', contentType);

    const aclConfig = {
        no_acl: true,
        actor: null,
    };

    if ( site.protected ) {
        const authService = req.services.get('auth');

        const getSiteActorFromToken = async () => {
            const siteToken = req.cookies['puter.site.token'];
            if ( ! siteToken ) return;

            let failed = false;
            let siteActor;
            try {
                siteActor =
                    await authService.authenticate_from_token(siteToken);
            } catch (e) {
                failed = true;
            }

            if ( failed ) return;

            if ( ! siteActor ) return;

            // security measure: if 'puter.site.token' is set
            //   to a different actor type, someone is likely
            //   trying to exploit the system.
            if ( ! (siteActor.type instanceof SiteActorType) ) {
                return;
            }

            aclConfig.actor = siteActor;

            // Refresh the token if it's been 30 seconds since
            // the last request
            if (
                (Date.now() - siteActor.type.iat * 1000)
                    >
                1000 * 30
            ) {
                const siteToken = authService.get_site_app_token({
                    site_uid: site.uuid,
                });
                res.cookie('puter.site.token', siteToken);
            }

            return true;
        };

        const makeSiteActorFromAppToken = async () => {
            const token = req.query['puter.auth.token'];

            aclConfig.no_acl = false;

            if ( ! token ) {
                const e = APIError.create('token_missing');
                return respondError({ req, res, e });
            }

            const appActor =
                await authService.authenticate_from_token(token);

            const userActor =
                appActor.get_related_actor(UserActorType);

            const permissionService = req.services.get('permission');
            const perm = await (async () => {
                if ( userActor.type.user.id === site.user_id ) {
                    return {};
                }

                const reading = await permissionService.scan(userActor, `site:uid#${site.uuid}:access`);
                const options = PermissionUtil.reading_to_options(reading);
                return options.length > 0;
            })();

            if ( ! perm ) {
                const e = APIError.create('forbidden');
                respondError({ req, res, e });
                return false;
            }

            const siteActor = await Actor.create(SiteActorType, { site });
            aclConfig.actor = siteActor;

            // This subdomain is allowed to keep the site actor token,
            // so we send it here as a cookie so other html files can
            // also load.
            const siteToken = authService.get_site_app_token({
                site_uid: site.uuid,
            });
            res.cookie('puter.site.token', siteToken);
            return true;
        };

        let ok = await getSiteActorFromToken();
        if ( ! ok ) {
            ok = await makeSiteActorFromAppToken();
        }
        if ( ! ok ) return;

        Object.freeze(aclConfig);
    }

    // Helper function to parse Range header
    const parseRangeHeader = (rangeHeader) => {
        // Check if this is a multipart range request
        if ( rangeHeader.includes(',') ) {
            // For now, we'll only serve the first range in multipart requests
            // as the underlying storage layer doesn't support multipart responses
            const firstRange = rangeHeader.split(',')[0].trim();
            const matches = firstRange.match(/bytes=(\d+)-(\d*)/);
            if ( ! matches ) return null;

            const start = parseInt(matches[1], 10);
            const end = matches[2] ? parseInt(matches[2], 10) : null;

            return { start, end, isMultipart: true };
        }

        // Single range request
        const matches = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if ( ! matches ) return null;

        const start = parseInt(matches[1], 10);
        const end = matches[2] ? parseInt(matches[2], 10) : null;

        return { start, end, isMultipart: false };
    };
    if ( req.headers['range'] ) {
        res.status(206);

        // Parse the Range header and set Content-Range
        const rangeInfo = parseRangeHeader(req.headers['range']);
        if ( rangeInfo ) {
            const { start, end, isMultipart } = rangeInfo;

            // For open-ended ranges, we need to calculate the actual end byte
            let actualEnd = end;
            let fileSize = null;

            try {
                fileSize = await targetNode.get('size');
                if ( end === null ) {
                    actualEnd = fileSize - 1; // File size is 1-based, end byte is 0-based
                }
            } catch (e) {
                // If we can't get file size, we'll let the storage layer handle it
                // and not set Content-Range header
                actualEnd = null;
                fileSize = null;
            }

            if ( actualEnd !== null ) {
                const totalSize = fileSize !== null ? fileSize : '*';
                const contentRange = `bytes ${start}-${actualEnd}/${totalSize}`;
                res.set('Content-Range', contentRange);
            }

            // If this was a multipart request, modify the range header to only include the first range
            if ( isMultipart ) {
                req.headers['range'] = end !== null
                    ? `bytes=${start}-${end}`
                    : `bytes=${start}-`;
            }
        }
    } else {
        if ( targetNode.entry.size ) {
            res.set('x-expected-entity-length', targetNode.entry.size);
        }
    }
    res.set({ 'Accept-Ranges': 'bytes' });

    const llRead = new LLRead();
    // const actor = Actor.adapt(req.user);
    const stream = await llRead.run({
        no_acl: aclConfig.no_acl,
        actor: aclConfig.actor,
        fsNode: targetNode,
        ...(req.headers['range'] ? { range: req.headers['range'] } : { }),
    });

    // Destroy the stream if the client disconnects
    req.on('close', () => {
        stream.destroy();
    });

    try {
        return stream.pipe(res);
    } catch (e) {
        const handled = await respondSiteError({
            path,
            req,
            res,
            next,
            subdomainRootPath,
        });
        if ( handled ) return;
        return res.status(500).send(`Error reading file: ${ e.message}`);
    }
}

async function respondSiteError ({ path, html, req, res, next, subdomainRootPath }) {
    const handled = await maybeRespondWithSiteConfig({
        path,
        html,
        req,
        res,
        next,
        subdomainRootPath,
        errorStatus: 500,
    });
    return handled;
}

async function getSiteErrorConfig (req, subdomainRootPath) {
    if ( ! subdomainRootPath ) return null;
    req.__puterSiteErrorConfigCache ??= Object.create(null);

    if ( req.__puterSiteErrorConfigCache[subdomainRootPath] !== undefined ) {
        return req.__puterSiteErrorConfigCache[subdomainRootPath];
    }

    try {
        const context = Context.get();
        const services = context.get('services');
        const filesystemService = services.get('filesystem');

        const configPath = `${subdomainRootPath}/${puterSiteConfigFilename}`;
        const configNode = await filesystemService.node(new NodePathSelector(configPath));
        await configNode.fetchEntry();

        if ( ! await configNode.exists() ) {
            req.__puterSiteErrorConfigCache[subdomainRootPath] = null;
            return null;
        }
        if ( await configNode.get('type') === TYPE_DIRECTORY ) {
            req.__puterSiteErrorConfigCache[subdomainRootPath] = null;
            return null;
        }

        const size = Number(await configNode.get('size') ?? 0);
        if ( Number.isFinite(size) && size > puterSiteConfigMaxSize ) {
            req.__puterSiteErrorConfigCache[subdomainRootPath] = null;
            return null;
        }

        const llRead = new LLRead();
        const stream = await llRead.run({
            no_acl: true,
            actor: null,
            fsNode: configNode,
        });
        const buffer = await streamToBuffer(stream);
        const text = buffer.toString('utf8');
        const parsed = parseSiteErrorConfig(text);

        req.__puterSiteErrorConfigCache[subdomainRootPath] = parsed;
        return parsed;
    } catch {
        req.__puterSiteErrorConfigCache[subdomainRootPath] = null;
        return null;
    }
}

async function getSiteFileNode (subdomainRootPath, sitePath) {
    const context = Context.get();
    const services = context.get('services');
    const filesystemService = services.get('filesystem');

    const fullPath = `${subdomainRootPath}${sitePath}`;
    const node = await filesystemService.node(new NodePathSelector(fullPath));
    await node.fetchEntry();
    if ( ! await node.exists() ) return null;
    if ( await node.get('type') === TYPE_DIRECTORY ) return null;
    return node;
}

async function maybeRespondWithSiteConfig ({
    path,
    html,
    req,
    res,
    next,
    subdomainRootPath,
    errorStatus,
}) {
    if ( ! subdomainRootPath ) return false;

    const parsedConfig = await getSiteErrorConfig(req, subdomainRootPath);
    if ( ! parsedConfig ) return false;

    const rule = getSiteErrorRule(parsedConfig, errorStatus);
    if ( ! rule ) return false;

    const responseStatus = rule.status ?? errorStatus;
    if ( rule.file ) {
        const node = await getSiteFileNode(subdomainRootPath, rule.file);
        if ( node ) {
            await streamSiteFile({
                req,
                res,
                fsNode: node,
                status: responseStatus,
            });
            return true;
        }
    }

    if ( rule.status !== null && rule.status !== undefined ) {
        respondHtmlError({ path, html, status: responseStatus }, req, res, next);
        return true;
    }

    return false;
}

async function streamSiteFile ({ req, res, fsNode, status }) {
    res.status(status);
    const contentType =
        contentTypeFromMime(await fsNode.get('name')) ||
        'application/octet-stream';
    res.set('Content-Type', contentType);

    const llRead = new LLRead();
    const stream = await llRead.run({
        no_acl: true,
        actor: null,
        fsNode,
    });

    req.on('close', () => {
        stream.destroy();
    });

    return stream.pipe(res);
}

async function respond404 ({ path, html }, req, res, next, subdomainRootPath) {
    const handled = await maybeRespondWithSiteConfig({
        path,
        html,
        req,
        res,
        next,
        subdomainRootPath,
        errorStatus: 404,
    });
    if ( handled ) return;

    if ( subdomainRootPath ) {
        const custom404Node = await getSiteFileNode(subdomainRootPath, '/404.html');
        if ( custom404Node ) {
            return streamSiteFile({
                req,
                res,
                fsNode: custom404Node,
                status: 404,
            });
        }
    }

    return respondHtmlError({ path, html, status: 404 }, req, res, next);
}

function respondHtmlError ({ path, html, status = 404 }, req, res, _next) {
    res.status(status);
    res.set('Content-Type', 'text/html; charset=UTF-8');
    res.write(`<div style="font-size: 20px;
        text-align: center;
        height: calc(100vh);
        display: flex;
        justify-content: center;
        flex-direction: column;">`);
    res.write(`<h1 style="margin:0; color:#727272;">${status}</h1>`);
    res.write('<p style="margin-top:10px;">');
    if ( status === 404 && path ) {
        if ( path === '/index.html' ) {
            res.write('<code>index.html</code> Not Found');
        } else {
            res.write('Not Found');
        }
    } else {
        res.write(html || 'Request failed');
    }
    res.write('</p>');

    res.write('</div>');

    return res.end();
}

function respondError ({ req, res, e }) {
    if ( ! (e instanceof APIError) ) {
        // TODO: alarm here
        e = APIError.create('unknown_error');
    }

    res.redirect(`${originUrl}?${e.querystringize({
        ...(req.query['puter.app_instance_id'] ? {
            'error_from_within_iframe': true,
        } : {}),
    })}`);
}

export async function puterSiteMiddleware (req, res, next) {
    const isSubdomain =
        req.hostname.endsWith(staticHostingDomain)
        || (staticHostingDomainAlt && req.hostname.endsWith(staticHostingDomainAlt))
        || req.subdomains[0] === 'devtest'
            ;

    if ( !isSubdomain && !req.is_custom_domain ) return next();

    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        const expectedCtx = req.ctx;
        const receivedCtx = Context.get();

        if ( expectedCtx && !receivedCtx ) {
            await expectedCtx.arun(async () => {
                await runInternal(req, res, next);
            });
        } else await runInternal(req, res, next);
    } catch ( e ) {
        console.error('puter-site middleware error', e);
        if ( !res.headersSent && req.__puterSiteRootPath ) {
            try {
                const handled = await respondSiteError({
                    path: req.path,
                    req,
                    res,
                    next,
                    subdomainRootPath: req.__puterSiteRootPath,
                });
                if ( handled ) return;
            } catch ( siteError ) {
                console.error('failed handling site error response', siteError);
            }
        }
        api_error_handler(e, req, res, next);
    }
}
