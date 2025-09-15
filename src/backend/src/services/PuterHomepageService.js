// METADATA // {"ai-commented":{"service":"openai-completion","model":"gpt-4o"}}
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
const { PathBuilder } = require("../util/pathutil");
const BaseService = require("./BaseService");
const {is_valid_url} = require('../helpers');
const { Endpoint } = require("../util/expressutil");
const { Context } = require("../util/context");

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
        this.gui_params = {};
    }


    /**
    * @description This method initializes the PuterHomepageService by loading the manifest file.
    * It reads the manifest file located at the specified path and parses its JSON content.
    * The parsed data is then assigned to the `manifest` property of the instance.
    * @returns {Promise} A promise that resolves with the initialized PuterHomepageService instance.
    */
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
    
    set_gui_param (key, val) {
        this.gui_params[key] = val;
    }


    async ['__on_install.routes'] (_, { app }) {
        Endpoint({
            route: '/whoarewe',
            methods: ['GET'],
            handler: async (req, res) => {
                // Get basic configuration information
                const responseData = {
                    disable_user_signup: this.global_config.disable_user_signup,
                    disable_temp_users: this.global_config.disable_temp_users,
                    environmentInfo: {
                        env: this.global_config.env,
                        version: process.env.VERSION || 'development'
                    }
                };

                // Add captcha requirement information
                responseData.captchaRequired = {
                    login: req.captchaRequired,
                    signup: req.captchaRequired,
                };
                
                res.json(responseData);
            }
        }).attach(app);
    }


    /**
    * This method sends the initial HTML page that loads the Puter GUI and its assets.
    */
    async send ({ req, res }, meta, launch_options) {
        const config = this.global_config;
        
        if (
            req.query['puter.app_instance_id'] ||
            req.query['error_from_within_iframe']
        ) {
            const easteregg = [
                'puter in puter?',
                'Infinite recursion!',
                'what\'chu cookin\'?',
            ];
            const message = req.query.message ||
                easteregg[
                    Math.floor(Math.random(easteregg.length))
                ];

            return res.send(this.generate_error_html({
                message,
            }));
        }
        
        // checkCaptcha middleware (in CaptchaService) sets req.captchaRequired
        const captchaRequired = {
            login: req.captchaRequired,
            signup: req.captchaRequired,
        };

        // cloudflare turnstile site key
        const turnstileSiteKey = config.services?.['cloudflare-turnstile']?.enabled ? config.services?.['cloudflare-turnstile']?.site_key : null;
        
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
                hosting_domain: config.static_hosting_domain +
                    (config.pub_port !== 80 && config.pub_port !== 443 ? ':' + config.pub_port : ''),
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
                disable_temp_users: config.disable_temp_users,
                co_isolation_enabled: req.co_isolation_enabled,
                // Add captcha requirements to GUI parameters
                captchaRequired: captchaRequired,
                turnstileSiteKey: turnstileSiteKey,
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

        const e = encode;

        const {
            title,
            description,
            short_description,
            company,
            canonical_url,
            social_media_image,
        } = meta;

        gui_params = {
            ...meta,
            ...gui_params,
            ...this.gui_params,
            launch_options,
            app_origin,
            api_origin,
            gui_origin: app_origin,
        };

        const asset_dir = env === 'dev'
            ? '/src' : '/dist' ;

        gui_params.asset_dir = asset_dir;

        const bundled = env != 'dev' || use_bundled_gui;

        // check if social media image is a valid absolute URL
        let is_social_media_image_valid = !!social_media_image;
        if (is_social_media_image_valid && !is_valid_url(social_media_image)) {
            is_social_media_image_valid = false;
        }

        // check if social media image ends with a valid image extension
        if (is_social_media_image_valid && !/\.(png|jpg|jpeg|gif|webp)$/.test(social_media_image.toLowerCase())) {
            is_social_media_image_valid = false;
        }

        // set social media image to default if it is not valid
        const social_media_image_url = is_social_media_image_valid ? social_media_image : `${asset_dir}/images/screenshot.png`;

        // Custom script tags to be added to the homepage by extensions
        // an event is emitted to allow extensions to add their own script tags
        // the event is emitted with an object containing a custom_script_tags array
        // which extensions can push their script tags to
        let custom_script_tags = [];
        let custom_script_tags_str = '';
        process.emit('add_script_tags_to_homepage_html', { custom_script_tags });

        for (const tag of custom_script_tags) {
            custom_script_tags_str += tag;
        }

        return `<!DOCTYPE html>
    <html lang="en">

    <head>
        <title>${e(title)}</title>
        <meta name="author" content="${e(company)}">
        <meta name="description" content="${e((description).replace(/\n/g, " ").trim())}">
        <meta name="facebook-domain-verification" content="e29w3hjbnnnypf4kzk2cewcdaxym1y" />
        <link rel="canonical" href="${e(canonical_url)}">

        <!-- Meta meta tags -->
        <meta property="og:url" content="${e(canonical_url)}">
        <meta property="og:type" content="website">
        <meta property="og:title" content="${e(title)}">
        <meta property="og:description" content="${e((short_description).replace(/\n/g, " ").trim())}">
        <meta property="og:image" content="${e(social_media_image_url)}">

        <!-- Twitter meta tags -->
        <meta name="twitter:card" content="summary_large_image">
        <meta property="twitter:domain" content="puter.com">
        <meta property="twitter:url" content="${e(canonical_url)}">
        <meta name="twitter:title" content="${e(title)}">
        <meta name="twitter:description" content="${e((short_description).replace(/\n/g, " ").trim())}">
        <meta name="twitter:image" content="${e(social_media_image_url)}">

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
        <link rel="preload" as="image" href="https://puter-assets.b-cdn.net/wallpaper.webp">

        <script>
            if ( ! window.service_script ) {
                /**
                * This method initializes the service by registering any necessary scripts and setting up GUI parameters.
                * It is called after the PuterHomepageService instance has been constructed and initialized.
                *
                * @param {import('express').Request} req - The Express request object.
                * @param {import('express').Response} res - The Express response object.
                * @param {object} meta - Metadata about the Puter instance, including the environment, manifest, and launch options.
                */
                // Add this comment above line 240
                // method: send
                // purpose: Send the initial HTML page that loads the Puter GUI and its assets.
                // notes: If the request contains certain query parameters, an error message will be returned instead.
                // parameters: req, res, meta, launch_options
                // return value: None, instead it sends an HTML response.
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
            custom_script_tags_str
        }
        ${
            use_bundled_gui
                ? `<script>window.gui_env = 'prod';</script>`
                : ''
        }

        <!-- Load the GUI script -->
        <script src="/dist/bundle.min.js"></script>
        <!-- Initialize GUI when document is loaded -->
        <script type="module">
        /**
        * This method generates the HTML for the initial Puter page, including script tags and other necessary metadata.
        * It takes in an object containing various parameters to customize the page.
        * It returns the generated HTML string.
        * @param {Object} params - An object containing the following properties:
        *  - env: The environment (e.g., 'dev' or 'prod')
        *  - manifest: The Puter GUI manifest
        *  - use_bundled_gui: A boolean indicating whether to use the bundled GUI or not
        *  - app_origin: The origin of the application
        *  - api_origin: The origin of the API
        *  - meta: The page metadata
        *  - launch_options: Launch options for the GUI
        *  - gui_params: GUI parameters
        */
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
    
    generate_error_html ({ message }) {
        const { encode } = require('html-entities');
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <style type="text/css">
                        @font-face {
                            font-family: 'Inter';
                            src: url('/fonts/Inter-Thin.ttf') format('truetype');
                            font-weight: 100;
                        }
                        BODY {
                            box-sizing: border-box;
                            margin: 0;
                            height: 100vh;
                            width: 100vw;
                            background-color: #2f70ab;
                            color: #f2f7f7;
                            font-family: "Inter", "Helvetica Neue", HelveticaNeue, Helvetica, Arial, sans-serif;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                    </style>
                </head>
                <body>
                    <h1>${
                        encode(message, { mode: 'nonAsciiPrintable' })
                    }</h1>
                </body>
            </html>
        `;
    }
}

module.exports = {
    PuterHomepageService
};
