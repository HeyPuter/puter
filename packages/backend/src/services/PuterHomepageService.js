const { PathBuilder } = require("../util/pathutil");
const BaseService = require("./BaseService");

/**
 * PuterHomepageService serves the initial HTML page that loads the Puter GUI
 * and all of its assets.
 */
class PuterHomepageService extends BaseService {
    static MODULES = {
        fs: require('node:fs'),
    }

    _construct () {
        this.service_scripts = [];
    }

    async _init () {
        // Load manifest
        const config = this.global_config;
        const manifest_raw = this.modules.fs.readFileSync(
            PathBuilder
                .add(config.assets.gui, { allow_traversal: true })
                .add('puter-gui.json')
                .build(),
            'utf8'
        );
        const manifest_data = JSON.parse(manifest_raw);
        this.manifest = manifest_data[config.assets.gui_profile];
    }

    register_script (url) {
        this.service_scripts.push(url);
    }

    async send (res, meta, launch_options) {
        const config = this.global_config;
        return res.send(this.generate_puter_page_html({
            env: config.env,

            app_origin: config.origin,
            api_origin: config.api_base_url,
            use_bundled_gui: config.use_bundled_gui,

            manifest: this.manifest,
            gui_path: config.assets.gui,

            // page meta
            meta,

            // launch options
            launch_options,

            // gui parameters
            gui_params: {
                app_name_regex: config.app_name_regex,
                app_name_max_length: config.app_name_max_length,
                app_title_max_length: config.app_title_max_length,
                subdomain_regex: config.subdomain_regex,
                subdomain_max_length: config.subdomain_max_length,
                domain: config.domain,
                protocol: config.protocol,
                env: config.env,
                api_base_url: config.api_base_url,
                thumb_width: config.thumb_width,
                thumb_height: config.thumb_height,
                contact_email: config.contact_email,
                max_fsentry_name_length: config.max_fsentry_name_length,
                require_email_verification_to_publish_website: config.require_email_verification_to_publish_website,
                short_description: config.short_description,
                long_description: config.long_description,
            },
        }));
    }

    generate_puter_page_html ({
        env,

        manifest,
        gui_path,
        use_bundled_gui,

        app_origin,
        api_origin,

        meta,
        launch_options,

        gui_params,
    }) {
        const require = this.require;
        const {encode} = require('html-entities');
        const path_ = require('path');
        const fs_ = require('fs');

        const e = encode;

        const {
            title,
            description,
            short_description,
            company,
            canonical_url,
        } = meta;

        gui_params = {
            ...meta,
            ...gui_params,
            launch_options,
            app_origin,
            api_origin,
            gui_origin: app_origin,
        };

        const asset_dir = env === 'dev'
            ? '/src' : '/dist' ;
        // const asset_dir = '/dist';

        gui_params.asset_dir = asset_dir;

        const bundled = env != 'dev' || use_bundled_gui;

        const writeScriptTag = path =>
            `<script type="${
                Array.isArray(path) ? 'text/javascirpt' : 'module'
            }" src="${Array.isArray(path) ? path[0] : path}"></script>\n`
            ;

        return `<!DOCTYPE html>
    <html lang="en">

    <head>
        <title>${e(title)}</title>
        <meta name="author" content="${e(company)}">
        <meta name="description" content="${e((description).replace(/\n/g, " "))}">
        <meta name="facebook-domain-verification" content="e29w3hjbnnnypf4kzk2cewcdaxym1y" />
        <link rel="canonical" href="${e(canonical_url)}">

        <!-- Meta meta tags -->
        <meta property="og:url" content="${app_origin}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="${e(title)}">
        <meta property="og:description" content="${e((short_description).replace(/\n/g, " "))}">
        <meta property="og:image" content="${asset_dir}/images/screenshot.png">

        <!-- Twitter meta tags -->
        <meta name="twitter:card" content="summary_large_image">
        <meta property="twitter:domain" content="puter.com">
        <meta property="twitter:url" content="${app_origin}">
        <meta name="twitter:title" content="${e(title)}">
        <meta name="twitter:description" content="${e((short_description).replace(/\n/g, " "))}">
        <meta name="twitter:image" content="${asset_dir}/images/screenshot.png">

        <!-- favicons -->
        <link rel="apple-touch-icon" sizes="57x57" href="${asset_dir}/favicons/apple-icon-57x57.png">
        <link rel="apple-touch-icon" sizes="60x60" href="${asset_dir}/favicons/apple-icon-60x60.png">
        <link rel="apple-touch-icon" sizes="72x72" href="${asset_dir}/favicons/apple-icon-72x72.png">
        <link rel="apple-touch-icon" sizes="76x76" href="${asset_dir}/favicons/apple-icon-76x76.png">
        <link rel="apple-touch-icon" sizes="114x114" href="${asset_dir}/favicons/apple-icon-114x114.png">
        <link rel="apple-touch-icon" sizes="120x120" href="${asset_dir}/favicons/apple-icon-120x120.png">
        <link rel="apple-touch-icon" sizes="144x144" href="${asset_dir}/favicons/apple-icon-144x144.png">
        <link rel="apple-touch-icon" sizes="152x152" href="${asset_dir}/favicons/apple-icon-152x152.png">
        <link rel="apple-touch-icon" sizes="180x180" href="${asset_dir}/favicons/apple-icon-180x180.png">
        <link rel="icon" type="image/png" sizes="192x192"  href="${asset_dir}/favicons/android-icon-192x192.png">
        <link rel="icon" type="image/png" sizes="32x32" href="${asset_dir}/favicons/favicon-32x32.png">
        <link rel="icon" type="image/png" sizes="96x96" href="${asset_dir}/favicons/favicon-96x96.png">
        <link rel="icon" type="image/png" sizes="16x16" href="${asset_dir}/favicons/favicon-16x16.png">
        <link rel="manifest" href="${asset_dir}/manifest.json">
        <meta name="msapplication-TileColor" content="#ffffff">
        <meta name="msapplication-TileImage" content="${asset_dir}/favicons/ms-icon-144x144.png">
        <meta name="theme-color" content="#ffffff">

        <!-- Preload images when applicable -->
        <link rel="preload" as="image" href="${asset_dir}/images/wallpaper.webp">

        <script>
            if ( ! window.service_script ) {
                window.service_script_api_promise = (() => {
                    let resolve, reject;
                    const promise = new Promise((res, rej) => {
                        resolve = res;
                        reject = rej;
                    });
                    promise.resolve = resolve;
                    promise.reject = reject;
                    return promise;
                })();
                window.service_script = async fn => {
                    try {
                        await fn(await window.service_script_api_promise);
                    } catch (e) {
                        console.error('service_script(ERROR)', e);
                    }
                };
            }
        </script>

        <!-- Files from JSON (may be empty) -->
        ${
            ((!bundled && manifest?.css_paths)
                ? manifest.css_paths.map(path => `<link rel="stylesheet" href="${path}">\n`)
                : []).join('')
        }
        <!-- END Files from JSON -->
    </head>

    <body>
        <script>window.puter_gui_enabled = true;</script>
        ${
            use_bundled_gui
                ? `<script>window.gui_env = 'prod';</script>`
                : ''
        }
        ${
            ((!bundled && manifest?.lib_paths)
                ? manifest.lib_paths.map(path => `<script type="text/javascript" src="${path}"></script>\n`)
                : []).join('')
        }

        <script>
        window.icons = {};

        ${(() => {
            if ( !(!bundled && manifest) ) return '';
            const html = [];
            fs_.readdirSync(path_.join(gui_path, 'src/icons')).forEach(file => {
                // skip dotfiles
                if(file.startsWith('.'))
                    return;
                // load image
                let buff = new Buffer.from(fs_.readFileSync(path_.join(gui_path, 'src/icons') + '/' + file));
                // convert to base64
                let base64data = buff.toString('base64');
                // add to `window.icons`
                if(file.endsWith('.png'))
                    html.push(`window.icons['${file}'] = "data:image/png;base64,${base64data}";\n`);
                else if(file.endsWith('.svg'))
                    html.push(`window.icons['${file}'] = "data:image/svg+xml;base64,${base64data}";\n`);
            })
            return html.join('');
        })()}
        </script>

        ${
            ((!bundled && manifest?.js_paths)
                ? manifest.js_paths.map(path => writeScriptTag(path))
                : []).join('')
        }
        <!-- Load the GUI script -->
        <script ${
            // !bundled ? ' type="module"' : ''
            ' type="module"'
        } src="${(!bundled && manifest?.index) || '/dist/gui.js'}"></script>
        <!-- Initialize GUI when document is loaded -->
        <script type="module">
        window.addEventListener('load', function() {
            gui(${
                // TODO: override JSON.stringify to ALWAYS to this...
                //       this should be an opt-OUT, not an opt-IN!
                JSON.stringify(gui_params).replace(/</g, '\\u003c')
            });
        });
        </script>
        <!-- Initialize Service Scripts -->
        ${
            this.service_scripts
                .map(path => `<script type="module" src="${path}"></script>\n`)
                .join('')
        }
        <div id="templates" style="display: none;"></div>
    </body>

    </html>`;
    };
}

module.exports = {
    PuterHomepageService
};
