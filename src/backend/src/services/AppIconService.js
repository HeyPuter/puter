const { HLWrite } = require("../filesystem/hl_operations/hl_write");
const { LLMkdir } = require("../filesystem/ll_operations/ll_mkdir");
const { LLRead } = require("../filesystem/ll_operations/ll_read");
const { NodePathSelector } = require("../filesystem/node/selectors");
const { Endpoint } = require("../util/expressutil");
const { buffer_to_stream } = require("../util/streamutil");
const BaseService = require("./BaseService");

const ICON_SIZES = [16,32,64,128,256,512];

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
    }

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

                // Get icon file node
                const dir_app_icons = await this.get_app_icons();
                const node = await dir_app_icons.getChild(`${app_uid}-${size}.png`);
                await node.fetchEntry();

                const svc_su = this.services.get('su');
                const ll_read = new LLRead();
                const stream = await ll_read.run({
                    fsNode: node,
                    actor: await svc_su.get_system_actor(),
                });

                res.set('Content-Type', 'image/png');
                stream.pipe(res);
            },
        }).attach(app);
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
        });
    }

    async _init () {
    }
}

module.exports = {
    AppIconService,
};
