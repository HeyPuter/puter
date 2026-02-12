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

import config from '../../config.js';
import { createRequire } from 'node:module';
import { HLWrite } from '../../filesystem/hl_operations/hl_write.js';
import { LLMkdir } from '../../filesystem/ll_operations/ll_mkdir.js';
import { LLRead } from '../../filesystem/ll_operations/ll_read.js';
import { NodePathSelector } from '../../filesystem/node/selectors.js';
import { APP_ICONS_SUBDOMAIN } from '../../consts/app-icons.js';
import { get_app, get_user } from '../../helpers.js';
import BaseService from '../../services/BaseService.js';
import { DB_WRITE } from '../../services/database/consts.js';
import { Endpoint } from '../../util/expressutil.js';
import { buffer_to_stream, stream_to_buffer } from '../../util/streamutil.js';
import DEFAULT_APP_ICON from './default-app-icon.js';
import IconResult from './lib/IconResult.js';

const require = createRequire(import.meta.url);

const ICON_SIZES = [16, 32, 64, 128, 256, 512];
const LEGACY_ICON_FILENAME = ({ appUid, size }) => `${appUid}-${size}.png`;
const ORIGINAL_ICON_FILENAME = ({ appUid }) => `${appUid}.png`;
const REDIRECT_MAX_AGE_SIZE = 30 * 24 * 60 * 60; // 1 month
const REDIRECT_MAX_AGE_ORIGINAL = 7 * 24 * 60 * 60; // 1 week

/**
 * AppIconService handles icon generation and serving for apps.
 *
 * This is done by listening to the `app.new-icon` event which is
 * dispatched by AppES. `sharp` is used to resize the images to
 * pre-selected sizees in the `ICON_SIZES` constant defined above.
 *
 * Icons are stored in and served from the `/system/app_icons`
 * directory. If the system user does not have this directory,
 * it will be created in the consolidation boot phase after
 * UserService emits the `user.system-user-ready` event on the
 * service container event bus.
 */
export class AppIconService extends BaseService {
    static MODULES = {
        sharp: require('sharp'),
        bmp: require('sharp-bmp'),
        ico: require('sharp-ico'),
        uuidv4: require('uuid').v4,
    };

    static ICON_SIZES = ICON_SIZES;

    /**
     * AppIconService listens to this event to register the
     * endpoint /app-icon/:app_uid/:size which serves the
     * app icon at the requested size.
     */
    async ['__on_install.routes'] (_, { app }) {
        Endpoint({
            route: '/app-icon/:app_uid/:size',
            methods: ['GET'],
            handler: async (req, res) => {
                // Validate parameters
                let { app_uid: appUid, size } = req.params;
                if ( ! ICON_SIZES.includes(Number(size)) ) {
                    res.status(400).send('Invalid size');
                    return;
                }
                if ( ! appUid.startsWith('app-') ) {
                    appUid = `app-${appUid}`;
                }

                const {
                    stream,
                    mime,
                    redirectUrl,
                    redirectCacheControl,
                } = await this.getIconStream({ appUid, size, allowRedirect: true });

                if ( redirectUrl ) {
                    if ( redirectCacheControl ) {
                        res.set('Cache-Control', redirectCacheControl);
                    }
                    return res.redirect(302, redirectUrl);
                }

                res.set('Content-Type', mime);
                res.set('Cache-Control', 'public, max-age=3600');
                stream.pipe(res);
            },
        }).attach(app);
    }

    getSizes () {
        return this.constructor.ICON_SIZES;
    }

    async iconifyApps ({ apps, size }) {
        return await Promise.all(apps.map(async app => {
            const iconResult = await this.getIconStream({
                appIcon: app.icon,
                appUid: app.uid ?? app.uuid,
                size,
            });

            if ( iconResult.dataUrl ?? iconResult.data_url ) {
                app.icon = iconResult.dataUrl ?? iconResult.data_url;
                return app;
            }

            try {
                const buffer = await stream_to_buffer(iconResult.stream);
                const respDataUrl = `data:${iconResult.mime};base64,${buffer.toString('base64')}`;

                app.icon = respDataUrl;
            } catch (e) {
                this.errors.report('get-launch-apps:icon-stream', {
                    source: e,
                });
            }
            return app;
        }));
    }

    async getIconStream (params) {
        const result = await this.#getIconStream(params);
        return new IconResult(result);
    }

    normalizeAppUid (appUid) {
        if ( typeof appUid !== 'string' ) return appUid;
        return appUid.startsWith('app-') ? appUid : `app-${appUid}`;
    }

    isDataUrl (value) {
        return (
            typeof value === 'string' &&
            value.startsWith('data:') &&
            value.includes(',')
        );
    }

    parseAppIconEndpointUrl (iconUrl) {
        if ( typeof iconUrl !== 'string' || iconUrl.startsWith('data:') ) {
            return null;
        }

        let pathname;
        try {
            pathname = new URL(iconUrl, 'http://localhost').pathname;
        } catch {
            return null;
        }

        const match = pathname.match(/^\/app-icon\/([^/]+)\/(\d+)\/?$/);
        if ( ! match ) return null;

        return {
            appUid: this.normalizeAppUid(match[1]),
            size: Number(match[2]),
        };
    }

    isAppIconEndpointUrl (iconUrl) {
        return !!this.parseAppIconEndpointUrl(iconUrl);
    }

    isSameAppIconEndpointUrl ({ iconUrl, appUid, size }) {
        const parsed = this.parseAppIconEndpointUrl(iconUrl);
        if ( ! parsed ) return false;
        return (
            parsed.appUid === this.normalizeAppUid(appUid) &&
            Number(parsed.size) === Number(size)
        );
    }

    extractPuterSubdomainFromUrl (url) {
        if ( typeof url !== 'string' ) return null;

        let hostname;
        try {
            hostname = (new URL(url)).hostname.toLowerCase();
        } catch {
            return null;
        }

        const hostingDomains = [
            config.static_hosting_domain,
            config.static_hosting_domain_alt,
        ].filter(Boolean).map(v => v.toLowerCase());

        for ( const domain of hostingDomains ) {
            const suffix = `.${domain}`;
            if ( hostname.endsWith(suffix) ) {
                const subdomain = hostname.slice(0, hostname.length - suffix.length);
                return subdomain || null;
            }
        }

        return null;
    }

    isPuterSubdomainUrl (url) {
        return !!this.extractPuterSubdomainFromUrl(url);
    }

    getAppIconsBaseUrl () {
        if ( this.appIconsBaseUrl !== undefined ) {
            return this.appIconsBaseUrl;
        }

        const host = config.static_hosting_domain || config.static_hosting_domain_alt;
        if ( ! host ) {
            this.appIconsBaseUrl = null;
            return this.appIconsBaseUrl;
        }

        const protocol = config.protocol || 'https';

        this.appIconsBaseUrl = `${protocol}://${APP_ICONS_SUBDOMAIN}.${host}`;
        return this.appIconsBaseUrl;
    }

    getSizedIconUrl ({ appUid, size }) {
        const baseUrl = this.getAppIconsBaseUrl();
        if ( ! baseUrl ) return null;

        const normalizedAppUid = this.normalizeAppUid(appUid);
        return `${baseUrl}/${LEGACY_ICON_FILENAME({
            appUid: normalizedAppUid,
            size,
        })}`;
    }

    getOriginalIconUrl ({ appUid }) {
        const baseUrl = this.getAppIconsBaseUrl();
        if ( ! baseUrl ) return null;

        const normalizedAppUid = this.normalizeAppUid(appUid);
        return `${baseUrl}/${ORIGINAL_ICON_FILENAME({
            appUid: normalizedAppUid,
        })}`;
    }

    async ensureAppIconsDirectory ({ dirSystem = null } = {}) {
        const svcFs = this.services.get('filesystem');
        const svcSu = this.services.get('su');
        const svcUser = this.services.get('user');
        return await svcSu.sudo(async () => {
            const dirAppIcons = await svcFs.node(new NodePathSelector('/system/app_icons'));
            if ( await dirAppIcons.exists() ) {
                this.dir_app_icons = dirAppIcons;
                return dirAppIcons;
            }

            dirSystem = dirSystem || await svcUser.get_system_dir();
            if ( ! dirSystem ) {
                dirSystem = await svcFs.node(new NodePathSelector('/system'));
            }
            if ( ! await dirSystem.exists() ) {
                return dirAppIcons;
            }

            const llMkdir = new LLMkdir();
            await llMkdir.run({
                parent: dirSystem,
                name: 'app_icons',
                actor: await svcSu.get_system_actor(),
            });

            this.dir_app_icons = dirAppIcons;
            return dirAppIcons;
        });
    }

    async getOriginalIconLookup ({ dirAppIcons, appUid }) {
        const normalizedAppUid = this.normalizeAppUid(appUid);
        const originalFilename = ORIGINAL_ICON_FILENAME({ appUid: normalizedAppUid });
        const flatOriginalNode = await dirAppIcons.getChild(originalFilename);
        if ( await flatOriginalNode.exists() ) {
            return {
                node: flatOriginalNode,
                isFlatOriginal: true,
            };
        }
        return {
            node: null,
            isFlatOriginal: false,
        };
    }

    async ensureAppIconsSubdomain ({ dirAppIcons }) {
        const dbSites = this.services.get('database').get(DB_WRITE, 'sites');
        const existing = await dbSites.read('SELECT * FROM subdomains WHERE subdomain = ? LIMIT 1',
                        [APP_ICONS_SUBDOMAIN]);
        if ( existing[0] ) return existing[0];

        const systemUser = await get_user({ username: 'system' });
        if ( ! systemUser?.id ) return null;

        const rootDirId = await dirAppIcons.get('mysql-id');
        await dbSites.write(`INSERT ${dbSites.case({
            mysql: 'IGNORE',
            sqlite: 'OR IGNORE',
        })} INTO subdomains (subdomain, user_id, root_dir_id, uuid) VALUES (?, ?, ?, ?)`, [
            APP_ICONS_SUBDOMAIN,
            systemUser.id,
            rootDirId,
            `sd-${this.modules.uuidv4()}`,
        ]);

        const rows = await dbSites.read('SELECT * FROM subdomains WHERE subdomain = ? LIMIT 1',
                        [APP_ICONS_SUBDOMAIN]);
        return rows[0] ?? null;
    }

    async readIconNodeBuffer ({ node }) {
        const svcSu = this.services.get('su');
        const llRead = new LLRead();
        const stream = await llRead.run({
            fsNode: node,
            actor: await svcSu.get_system_actor(),
        });
        return await stream_to_buffer(stream);
    }

    async writePngToDir ({ destination_or_parent, filename, output }) {
        const svcSu = this.services.get('su');
        const sysActor = await svcSu.get_system_actor();
        const hlWrite = new HLWrite();
        await hlWrite.run({
            destination_or_parent,
            specified_name: filename,
            overwrite: true,
            actor: sysActor,
            user: sysActor.type.user,
            no_thumbnail: true,
            file: {
                size: output.length,
                name: filename,
                mimetype: 'image/png',
                type: 'image/png',
                stream: buffer_to_stream(output),
            },
        });
    }

    shouldRedirectIconUrl ({ iconUrl, appUid, size }) {
        if ( !iconUrl || this.isDataUrl(iconUrl) ) return false;

        const canRedirect =
            this.isPuterSubdomainUrl(iconUrl) ||
            this.isAppIconEndpointUrl(iconUrl);
        if ( ! canRedirect ) return false;

        return !this.isSameAppIconEndpointUrl({
            iconUrl,
            appUid,
            size,
        });
    }

    async generateMissingSizeFromOriginal ({ appUid, size }) {
        const normalizedAppUid = this.normalizeAppUid(appUid);
        const dirAppIcons = await this.ensureAppIconsDirectory();
        if ( ! await dirAppIcons.exists() ) return;
        const { node: originalNode } = await this.getOriginalIconLookup({
            dirAppIcons,
            appUid: normalizedAppUid,
        });
        if ( ! originalNode ) return;

        const sizedFilename = LEGACY_ICON_FILENAME({
            appUid: normalizedAppUid,
            size,
        });
        const sizedNode = await dirAppIcons.getChild(sizedFilename);
        if ( await sizedNode.exists() ) return;

        const originalBuffer = await this.readIconNodeBuffer({ node: originalNode });
        const output = await this.modules.sharp(originalBuffer)
            .resize(size)
            .png()
            .toBuffer();

        await this.writePngToDir({
            destination_or_parent: dirAppIcons,
            filename: sizedFilename,
            output,
        });
    }

    queueMissingSizeFromOriginal ({ appUid, size }) {
        if ( ! this.pendingIconSizeJobs ) {
            this.pendingIconSizeJobs = new Set();
        }

        const key = `${this.normalizeAppUid(appUid)}:${size}`;
        if ( this.pendingIconSizeJobs.has(key) ) return;

        this.pendingIconSizeJobs.add(key);
        Promise.resolve()
            .then(async () => {
                await this.generateMissingSizeFromOriginal({ appUid, size });
            })
            .catch(error => {
                this.errors.report('AppIconService.queueMissingSizeFromOriginal', {
                    source: error,
                    appUid,
                    size,
                });
            })
            .finally(() => {
                this.pendingIconSizeJobs.delete(key);
            });
    }

    async #getIconStream ({ appIcon, appUid, size, tries = 0, allowRedirect = false }) {
        appUid = this.normalizeAppUid(appUid);
        const appIconOriginal = appIcon;

        if ( appIcon && !this.isDataUrl(appIcon) ) {
            appIcon = null;
        }

        // If there is an icon provided, and it's an SVG, we'll just return it
        if ( appIcon ) {
            const [metadata, data] = appIcon.split(',');
            const inputMime = metadata.split(';')[0].split(':')[1];

            // svg icons will be sent as-is
            if ( inputMime === 'image/svg+xml' ) {
                return {
                    mime: 'image/svg+xml',
                    get stream () {
                        return buffer_to_stream(Buffer.from(data, 'base64'));
                    },
                    dataUrl: appIcon,
                    data_url: appIcon,
                };
            }
        }

        let app;
        const getAppCached = async () => {
            if ( app !== undefined ) return app;
            app = await get_app({ uid: appUid });
            return app;
        };

        const getFallbackIcon = async () => {
            let fallbackIcon = appIcon || await (async () => {
                const app = await getAppCached();
                return app?.icon || DEFAULT_APP_ICON;
            })();
            if ( ! this.isDataUrl(fallbackIcon) ) {
                fallbackIcon = DEFAULT_APP_ICON;
            }
            const [metadata, base64] = fallbackIcon.split(',');
            const mime = metadata.split(';')[0].split(':')[1];
            const img = Buffer.from(base64, 'base64');
            return {
                mime,
                stream: buffer_to_stream(img),
            };
        };

        const getExternalRedirect = async () => {
            if ( ! allowRedirect ) return null;

            const appIconUrl = this.shouldRedirectIconUrl({
                iconUrl: appIconOriginal,
                appUid,
                size,
            }) ? appIconOriginal : null;

            let dbIcon;
            if ( ! appIconUrl ) {
                dbIcon = (await getAppCached())?.icon;
            }

            const redirectUrl = [appIconUrl, dbIcon].find(url => this.shouldRedirectIconUrl({
                iconUrl: url,
                appUid,
                size,
            }));

            if ( ! redirectUrl ) return null;
            return { redirectUrl };
        };

        const dirAppIcons = await this.getAppIcons();
        const legacyFilename = LEGACY_ICON_FILENAME({ appUid, size });
        const legacyNode = await dirAppIcons.getChild(legacyFilename);

        if ( await legacyNode.exists() ) {
            if ( allowRedirect ) {
                const redirectUrl = this.getSizedIconUrl({ appUid, size });
                if ( redirectUrl ) {
                    return {
                        redirectUrl,
                        redirectCacheControl: `public, max-age=${REDIRECT_MAX_AGE_SIZE}`,
                    };
                }
            }

            try {
                const output = await this.readIconNodeBuffer({ node: legacyNode });
                return {
                    mime: 'image/png',
                    stream: buffer_to_stream(output),
                };
            } catch (e) {
                this.errors.report('AppIconService.get_icon_stream', {
                    source: e,
                });
                if ( tries < 1 ) {
                    // Choose the next size up, or 256 if we're already at 512.
                    const secondSize = size < 512 ? size * 2 : 256;
                    return await this.#getIconStream({
                        appUid,
                        appIcon: appIconOriginal,
                        size: secondSize,
                        tries: tries + 1,
                        allowRedirect,
                    });
                }
            }
        }

        const {
            node: originalNode,
            isFlatOriginal,
        } = await this.getOriginalIconLookup({ dirAppIcons, appUid });
        const hasOriginal = !!originalNode;

        if ( hasOriginal ) {
            this.queueMissingSizeFromOriginal({ appUid, size });

            if ( allowRedirect && isFlatOriginal ) {
                const redirectUrl = this.getOriginalIconUrl({ appUid });
                if ( redirectUrl ) {
                    return {
                        redirectUrl,
                        redirectCacheControl: `public, max-age=${REDIRECT_MAX_AGE_ORIGINAL}`,
                    };
                }
            }

            try {
                const output = await this.readIconNodeBuffer({ node: originalNode });
                return {
                    mime: 'image/png',
                    stream: buffer_to_stream(output),
                };
            } catch (e) {
                this.errors.report('AppIconService.get_icon_stream:original-read', {
                    source: e,
                });
            }
        }

        return await getExternalRedirect() || await getFallbackIcon();
    }

    /**
     * Returns an FSNodeContext instance for the app icons
     * directory.
     */
    async getAppIcons () {
        if ( this.dir_app_icons ) {
            return this.dir_app_icons;
        }

        const svcFs = this.services.get('filesystem');
        const dirAppIcons = await svcFs.node(new NodePathSelector('/system/app_icons'));

        return this.dir_app_icons = dirAppIcons;
    }

    getSharp ({ metadata, input }) {
        const type = metadata.split(';')[0].split(':')[1];

        if ( type === 'image/bmp' ) {
            return this.modules.bmp.sharpFromBmp(input);
        }

        const icotypes = ['image/x-icon', 'image/vnd.microsoft.icon'];
        if ( icotypes.includes(type) ) {
            const sharps = this.modules.ico.sharpsFromIco(input);
            return sharps[0];
        }

        return this.modules.sharp(input);
    }

    async loadIconSource ({ iconUrl }) {
        if ( typeof iconUrl !== 'string' || !iconUrl ) {
            return null;
        }

        if ( iconUrl.startsWith('data:') ) {
            const [metadata, base64] = iconUrl.split(',');
            return {
                metadata,
                input: Buffer.from(base64, 'base64'),
            };
        }

        try {
            const response = await fetch(iconUrl);
            if ( ! response.ok ) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return {
                input: Buffer.from(await response.arrayBuffer()),
                metadata: `data:${response.headers.get('content-type') || 'image/png'};base64`,
            };
        } catch ( error ) {
            this.errors.report('AppIconService.createAppIcons:fetchUrl', {
                source: error,
                iconUrl,
            });
            return null;
        }
    }

    /**
     * AppIconService listens to this event to create the
     * `/system/app_icons` directory if it does not exist,
     * and then to register the event listener for `app.new-icon`.
     */
    async ['__on_user.system-user-ready'] () {
        const svcSu = this.services.get('su');
        const svcUser = this.services.get('user');

        const dirSystem = await svcUser.get_system_dir();

        // Ensure app icons directory exists
        await svcSu.sudo(async () => {
            const dirAppIcons = await this.ensureAppIconsDirectory({ dirSystem });
            await this.ensureAppIconsSubdomain({ dirAppIcons });
        });

        // Listen for new app icons
        const svcEvent = this.services.get('event');
        svcEvent.on('app.new-icon', async (_, data) => {
            await this.createAppIcons({ data });
        });
    }

    async createAppIcons ({ data }) {
        const svcSu = this.services.get('su');
        const dataUrl = data.dataUrl ?? data.data_url;
        const appUid = this.normalizeAppUid(data.appUid ?? data.app_uid);
        if ( !dataUrl || !appUid ) return;

        const source = await this.loadIconSource({ iconUrl: dataUrl });
        if ( ! source ) return;

        const { input, metadata } = source;
        const isInputDataUrl = this.isDataUrl(dataUrl);

        await svcSu.sudo(async () => {
            const dirAppIcons = await this.ensureAppIconsDirectory();
            if ( ! await dirAppIcons.exists() ) {
                throw new Error('app icons directory is missing');
            }

            const sharpInstance = this.getSharp({ metadata, input });

            if ( isInputDataUrl ) {
                const originalOutput = await sharpInstance.clone()
                    .png()
                    .toBuffer();
                await this.writePngToDir({
                    destination_or_parent: dirAppIcons,
                    filename: ORIGINAL_ICON_FILENAME({ appUid }),
                    output: originalOutput,
                });

                const originalUrl = this.getOriginalIconUrl({ appUid });
                if ( originalUrl ) {
                    data.url = originalUrl;
                }
            }

            const iconJobs = ICON_SIZES.map(async size => {
                const output = await sharpInstance.clone()
                    .resize(size)
                    .png()
                    .toBuffer();
                await this.writePngToDir({
                    destination_or_parent: dirAppIcons,
                    filename: LEGACY_ICON_FILENAME({ appUid, size }),
                    output,
                });
            });
            await Promise.all(iconJobs);
        });
    }

    async _init () {
    }
}
