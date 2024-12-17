const { HLWrite } = require("../filesystem/hl_operations/hl_write");
const { LLMkdir } = require("../filesystem/ll_operations/ll_mkdir");
const { NodePathSelector, NodeChildSelector, RootNodeSelector } = require("../filesystem/node/selectors");
const { buffer_to_stream } = require("../util/streamutil");
const BaseService = require("./BaseService");

const ICON_SIZES = [16,32,64,128,256,512];

class AppIconService extends BaseService {
    static MODULES = {
        sharp: require('sharp'),
    }

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

        // Listen for new app icons
        const svc_event = this.services.get('event');
        svc_event.on('app.new-icon', async (_, data) => {
            // for ( let i=0; i < 10; i++ ) {
            //     console.log('\x1B[36;1m--- app icon ---\x1B[0m');
            // }
            // console.log('INFO', {
            //     event: 'app.new-icon',
            //     uid: data.app_uid,
            // });

            // Writing icons as the system user
            await svc_su.sudo(async () => {
                for ( const size of ICON_SIZES ) {
                    const filename = `${data.app_uid}-${size}.png`;
                    console.log('FILENAME', filename);
                    const data_url = data.data_url;
                    const base64 = data_url.split(',')[1];
                    const input = Buffer.from(base64, 'base64');
                    
                    // NOTE: A stream would be more ideal than a buffer here
                    //       but we have no way of knowing the output size
                    //       before we finish processing the image.
                    const output = await this.modules.sharp(input)
                        .resize(size)
                        .png()
                        .toBuffer();
                    
                    const hl_write = new HLWrite();
                    await hl_write.run({
                        destination_or_parent: dir_app_icons,
                        specified_name: filename,
                        overwrite: true,
                        user: await svc_su.get_system_actor(),
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
            })
        });
    }

    async _init () {
    }
}

module.exports = {
    AppIconService,
};
