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

const { HLWrite } = require("../../filesystem/hl_operations/hl_write");
const { LLMkdir } = require("../../filesystem/ll_operations/ll_mkdir");
const { LLRead } = require("../../filesystem/ll_operations/ll_read");
const { NodePathSelector } = require("../../filesystem/node/selectors");
const { get_app } = require("../../helpers");
const { Endpoint } = require("../../util/expressutil");
const { buffer_to_stream, stream_to_buffer } = require("../../util/streamutil");
const BaseService = require("../../services/BaseService.js");

const ICON_SIZES = [16,32,64,128,256,512];

const DEFAULT_APP_ICON = require('./default-app-icon.js');
const IconResult = require("./lib/IconResult.js");

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
class AppIconService extends BaseService {
    static MODULES = {
        sharp: require('sharp'),
        bmp: require('sharp-bmp'),
        ico: require('sharp-ico'),
    }
    
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
                let { app_uid, size } = req.params;
                if ( ! ICON_SIZES.includes(Number(size)) ) {
                    res.status(400).send('Invalid size');
                    return;
                }
                if ( ! app_uid.startsWith('app-') ) {
                    app_uid = `app-${app_uid}`;
                }

                const {
                    stream,
                    mime,
                } = await this.get_icon_stream({ app_uid, size, })

                res.set('Content-Type', mime);
                stream.pipe(res);
            },
        }).attach(app);
    }
    
    get_sizes () {
        return this.constructor.ICON_SIZES;
    }
    
    async iconify_apps ({ apps, size }) {
        return await Promise.all(apps.map(async app => {
            const icon_result = await this.get_icon_stream({
                app_icon: app.icon,
                app_uid: app.uid ?? app.uuid,
                size: size,
            });

            if ( icon_result.data_url ) {
                app.icon = icon_result.data_url;
                return app;
            }

            try {
                const buffer = await stream_to_buffer(icon_result.stream);
                const resp_data_url = `data:${icon_result.mime};base64,${buffer.toString('base64')}`;
                
                app.icon = resp_data_url;
            } catch (e) {
                this.errors.report('get-launch-apps:icon-stream', {
                    source: e,
                });
            }
            return app;
        }));
    }

    async get_icon_stream (params) {
        const result = await this.get_icon_stream_(params);
        return new IconResult(result);
    }

    async get_icon_stream_ ({ app_icon, app_uid, size, tries = 0 }) {
        // If there is an icon provided, and it's an SVG, we'll just return it
        if ( app_icon ) {
            const [metadata, data] = app_icon.split(',');
            const input_mime = metadata.split(';')[0].split(':')[1];

            // svg icons will be sent as-is
            if (input_mime === 'image/svg+xml') {
                return {
                    mime: 'image/svg+xml',
                    get stream () {
                        return buffer_to_stream(Buffer.from(data, 'base64'));
                    },
                    data_url: app_icon,
                }
            }
        }

        // Get icon file node
        const dir_app_icons = await this.get_app_icons();
        console.log('APP UID', app_uid);
        const node = await dir_app_icons.getChild(`${app_uid}-${size}.png`);

        const get_fallback_icon = async () => {
            // Use database-stored icon as a fallback
            app_icon = app_icon || await (async () => {
                const app = await get_app({ uid: app_uid });
                return app.icon || DEFAULT_APP_ICON;
            })()
            const [metadata, base64] = app_icon.split(',');
            const mime = metadata.split(';')[0].split(':')[1];
            const img = Buffer.from(base64, 'base64');
            return {
                mime,
                stream: buffer_to_stream(img),
            };
        }

        if ( ! await node.exists() ) {
            return await get_fallback_icon();
        }

        try {
            const svc_su = this.services.get('su');
            const ll_read = new LLRead();
            return {
                mime: 'image/png',
                stream: await ll_read.run({
                    fsNode: node,
                    actor: await svc_su.get_system_actor(),
                })
            };
        } catch (e) {
            this.errors.report('AppIconService.get_icon_stream', {
                source: e,
            });
            if ( tries < 1 ) {
                // We can choose the fallback icon in these two ways:

                // Choose the next size up, or 256 if we're already at 512;
                // this prioritizes icon quality over speed and bandwidth.
                let second_size = size < 512 ? size * 2 : 256;

                // Choose the next size down, or 32 if we're already at 16;
                // this prioritizes speed and bandwidth over icon quality.
                // let second_size = size > 16 ? size / 2 : 32;

                return await this.get_icon_stream({
                    app_uid, size: second_size, tries: tries + 1
                });
            }
            return await get_fallback_icon();
        }
    }

    /**
     * Returns an FSNodeContext instance for the app icons
     * directory.
     */
    async get_app_icons () {
        if ( this.dir_app_icons ) {
            return this.dir_app_icons;
        }

        const svc_fs = this.services.get('filesystem');
        const dir_app_icons = await svc_fs.node(
            new NodePathSelector('/system/app_icons')
        );

        this.dir_app_icons = dir_app_icons;
    }

    get_sharp ({ metadata, input }) {
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
    
    /**
     * AppIconService listens to this event to create the
     * `/system/app_icons` directory if it does not exist,
     * and then to register the event listener for `app.new-icon`.
     */
    async ['__on_user.system-user-ready'] () {
        const svc_su = this.services.get('su');
        const svc_fs = this.services.get('filesystem');
        const svc_user = this.services.get('user');

        const dir_system = await svc_user.get_system_dir();

        // Ensure app icons directory exists
        const dir_app_icons = await svc_fs.node(
            new NodePathSelector('/system/app_icons')
        );
        if ( ! await dir_app_icons.exists() ) {
            const ll_mkdir = new LLMkdir();
            await ll_mkdir.run({
                parent: dir_system,
                name: 'app_icons',
                actor: await svc_su.get_system_actor(),
            });
        }
        this.dir_app_icons = dir_app_icons;

        // Listen for new app icons
        const svc_event = this.services.get('event');
        svc_event.on('app.new-icon', async (_, data) => {
            await this.create_app_icons({ data });
        });
    }

    async create_app_icons ({ data }) {
        const svc_su = this.services.get('su');
        const dir_app_icons = await this.get_app_icons();

        // Writing icons as the system user
        const icon_jobs = [];
        for ( const size of ICON_SIZES ) {
            icon_jobs.push((async () => {
                await svc_su.sudo(async () => {
                    const filename = `${data.app_uid}-${size}.png`;
                    console.log('FILENAME', filename);
                    const data_url = data.data_url;
                    const [metadata, base64] = data_url.split(',');
                    const input = Buffer.from(base64, 'base64');

                    const sharp_instance = this.get_sharp({
                        metadata,
                        input,
                    });
                    
                    // NOTE: A stream would be more ideal than a buffer here
                    //       but we have no way of knowing the output size
                    //       before we finish processing the image.
                    const output = await sharp_instance
                        .resize(size)
                        .png()
                        .toBuffer();
                    
                    const sys_actor = await svc_su.get_system_actor();
                    const hl_write = new HLWrite();
                    await hl_write.run({
                        destination_or_parent: dir_app_icons,
                        specified_name: filename,
                        overwrite: true,
                        actor: sys_actor,
                        user: sys_actor.type.user,
                        no_thumbnail: true,
                        file: {
                            size: output.length,
                            name: filename,
                            mimetype: 'image/png',
                            type: 'image/png',
                            stream: buffer_to_stream(output),
                        },
                    });
                })
            })());
        }
        await Promise.all(icon_jobs);
    }

    async _init () {
    }
}

module.exports = {
    AppIconService,
};
