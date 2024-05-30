/*
Copyright (C) 2024  Puter Technologies Inc.

This file is part of Puter.com.

Puter.com is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/
import { encode } from 'html-entities';
import fs from 'fs';
import path from 'path';
import webpack from 'webpack';
import CleanCSS from 'clean-css';
import uglifyjs from 'uglify-js';
import { lib_paths, css_paths, js_paths } from './src/static-assets.js';
import { fileURLToPath } from 'url';

// Polyfill __dirname, which doesn't exist in modules mode
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the application by performing various tasks such as cleaning the distribution directory,
 * merging and minifying JavaScript and CSS files, bundling GUI core files, handling images,
 * and preparing the final distribution package. The process involves concatenating library
 * scripts, optimizing them for production, and copying essential assets to the distribution
 * directory. The function also supports a verbose mode for logging detailed information during
 * the build process.
 *
 * @param {Object} [options] - Optional parameters to customize the build process.
 * @param {boolean} [options.verbose=false] - Specifies whether to log detailed information during the build.
 *
 * @async
 * @returns {Promise<void>} A promise that resolves when the build process is complete.
 *
 * @example
 * build({ verbose: true }).then(() => {
 *   console.log('Build process completed successfully.');
 * }).catch(error => {
 *   console.error('Build process failed:', error);
 * });
 */
async function build(options){
    // -----------------------------------------------
    // Delete ./dist/ directory if it exists and create a new one
    // -----------------------------------------------
    if(fs.existsSync(path.join(__dirname, 'dist'))){
        fs.rmSync(path.join(__dirname, 'dist'), {recursive: true});
    }
    fs.mkdirSync(path.join(__dirname, 'dist'));

    // -----------------------------------------------
    // Concat/merge the JS libraries and save them to ./dist/libs.js
    // -----------------------------------------------
    let js = '';
    for(let i = 0; i < lib_paths.length; i++){
        const file = path.join(__dirname, 'src', lib_paths[i]);
        // js
        if(file.endsWith('.js') && !file.endsWith('.min.js')){
            let minified_code = await uglifyjs.minify(fs.readFileSync(file).toString(), {mangle: false});
            if(minified_code && minified_code.code){
                js += minified_code.code;
                if(options?.verbose)
                    console.log('minified: ', file);
            }
        }else{
            js += fs.readFileSync(file);
            if(options?.verbose)
                console.log('skipped minification: ', file);
        }

        js += '\n\n\n';
    }

    // -----------------------------------------------
    // Combine all images into a single js file
    // -----------------------------------------------
    let icons = 'window.icons = [];\n\n\n';
    fs.readdirSync(path.join(__dirname, 'src/icons')).forEach(file => {
        // skip dotfiles
        if(file.startsWith('.'))
            return;
        // load image
        let buff = new Buffer.from(fs.readFileSync(path.join(__dirname, 'src/icons') + '/' + file));
        // convert to base64
        let base64data = buff.toString('base64');
        // add to `window.icons`
        if(file.endsWith('.png'))
            icons += `window.icons['${file}'] = "data:image/png;base64,${base64data}";\n`;
        else if(file.endsWith('.svg'))
            icons += `window.icons['${file}'] = "data:image/svg+xml;base64,${base64data}";\n`;
    });

    // -----------------------------------------------
    // concat/merge the CSS files and save them to ./dist/bundle.min.css
    // -----------------------------------------------
    let css = '';
    for(let i = 0; i < css_paths.length; i++){
        let fullpath = path.join(__dirname, 'src', css_paths[i]);
        // minify CSS files if not already minified, then concatenate
        if(css_paths[i].endsWith('.css') && !css_paths[i].endsWith('.min.css')){
            const minified_css = new CleanCSS({}).minify(fs.readFileSync(fullpath).toString()); 
            css += minified_css.styles;
        }
        // otherwise, just concatenate the file
        else
            css += fs.readFileSync(path.join(__dirname, 'src', css_paths[i]));

        // add newlines between files
        css += '\n\n\n';
    }
    fs.writeFileSync(path.join(__dirname, 'dist', 'bundle.min.css'), css);

    // -----------------------------------------------
    // Bundle GUI core and merge all files into a single JS file
    // -----------------------------------------------
    let main_array = [];
    for(let i = 0; i < js_paths.length; i++){
        main_array.push(path.join(__dirname, 'src', js_paths[i]));
    }
    webpack({
        mode: 'production',
        entry: {
            main: main_array,
        },
            output: {
            path: path.resolve(__dirname, 'dist'),
            filename: '[name].js',
        },
        optimization: {
            minimize: true,
        },
    }, (err, stats) => {
        if(err){
            console.error(err);
            return;
        }
        if(options?.verbose)
            console.log(stats.toString());
        // write to ./dist/bundle.min.js
        fs.writeFileSync(path.join(__dirname, 'dist', 'bundle.min.js'), icons + '\n\n\n' + js + '\n\n\n' + fs.readFileSync(path.join(__dirname, 'dist', 'main.js')));
        // remove ./dist/main.js
        fs.unlinkSync(path.join(__dirname, 'dist', 'main.js'));
    });

    // Copy index.js to dist/gui.js
    // Prepend `window.gui_env="prod";` to `./dist/gui.js`
    fs.writeFileSync(
        path.join(__dirname, 'dist', 'gui.js'), 
        `window.gui_env="prod"; \n\n` + fs.readFileSync(path.join(__dirname, 'src', 'index.js'))
    );

    const copy_these = [
        'images', 
        'fonts',
        'favicons',
        'browserconfig.xml', 
        'manifest.json', 
        'favicon.ico',
        'security.txt',
    ];

    const recursive_copy = (src, dest) => {
        const stat = fs.statSync(src);
        if ( stat.isDirectory() ) {
            if( ! fs.existsSync(dest) ) fs.mkdirSync(dest);
            const files = fs.readdirSync(src);
            for ( const file of files ) {
                recursive_copy(path.join(src, file), path.join(dest, file));
            }
        } else {
            fs.copyFileSync(src, dest);
        }
    };

    for ( const to_copy of copy_these ) {
        recursive_copy(path.join(__dirname, 'src', to_copy), path.join(__dirname, 'dist', to_copy));
    }
}

/**
 * Generates the HTML content for the GUI based on the specified configuration options. The function
 * creates a new HTML document with the specified title, description, and other metadata. The function
 * also includes the necessary CSS and JavaScript files, as well as the required meta tags for social
 * media sharing and search engine optimization. The function is designed to be used in development
 * environments to generate the HTML content for the GUI.
 * 
 * @param {Object} options - The configuration options for the GUI.
 * @param {string} options.env - The environment in which the GUI is running (e.g., "dev" or "prod").
 * @param {string} options.api_origin - The origin of the API server.
 * @param {string} options.title - The title of the GUI.
 * @param {string} options.company - The name of the company or organization.
 * @param {string} options.description - The description of the GUI.
 * @param {string} options.app_description - The description of the application.
 * @param {string} options.short_description - The short description of the GUI.
 * @param {string} options.origin - The origin of the GUI.
 * @param {string} options.social_card - The URL of the social media card image.
 * @returns {string} The HTML content for the GUI based on the specified configuration options.
 * 
 */
function generateDevHtml(options){
    let start_t = Date.now();

    // final html string
    let h = '';

    h += `<!DOCTYPE html>`;
    h += `<html lang="en">`;

    h += `<head>`;
        h += `<title>${encode((options.title))}</title>`
        h += `<meta name="author" content="${encode(options.company)}">`
        // description
        let description = options.description;
        // if app_description is set, use that instead
        if(options.app_description){
            description = options.app_description;
        }
        // if no app_description is set, use short_description if set
        else if(options.short_description){
            description = options.short_description;
        }

        // description
        h += `<meta name="description" content="${encode((description).replace(/\n/g, " "))}">`
        // facebook domain verification
        h += `<meta name="facebook-domain-verification" content="e29w3hjbnnnypf4kzk2cewcdaxym1y" />`;
        // canonical url
        h += `<link rel="canonical" href="${options.origin}">`;

        // DEV: load every CSS file individually
        if(options.env === 'dev'){
            for(let i = 0; i < css_paths.length; i++){
                h += `<link rel="stylesheet" href="${css_paths[i]}">`;
            }
        }

        // Facebook meta tags
        h += `<meta property="og:url" content="https://${options.domain}">`;
        h += `<meta property="og:type" content="website">`;
        h += `<meta property="og:title" content="${encode(options.title)}">`;
        h += `<meta property="og:description" content="${encode((options.short_description).replace(/\n/g, " "))}">`;
        h += `<meta property="og:image" content="${options.social_card}">`;

        // Twitter meta tags
        h += `<meta name="twitter:card" content="summary_large_image">`;
        h += `<meta property="twitter:domain" content="${options.domain}">`;
        h += `<meta property="twitter:url" content="https://${options.domain}">`;
        h += `<meta name="twitter:title" content="${encode(options.title)}">`;
        h += `<meta name="twitter:description" content="${encode((options.short_description).replace(/\n/g, " "))}">`;
        h += `<meta name="twitter:image" content="${options.social_card}">`;

        // favicons
        h += `
        <link rel="apple-touch-icon" sizes="57x57" href="/favicons/apple-icon-57x57.png">
        <link rel="apple-touch-icon" sizes="60x60" href="/favicons/apple-icon-60x60.png">
        <link rel="apple-touch-icon" sizes="72x72" href="/favicons/apple-icon-72x72.png">
        <link rel="apple-touch-icon" sizes="76x76" href="/favicons/apple-icon-76x76.png">
        <link rel="apple-touch-icon" sizes="114x114" href="/favicons/apple-icon-114x114.png">
        <link rel="apple-touch-icon" sizes="120x120" href="/favicons/apple-icon-120x120.png">
        <link rel="apple-touch-icon" sizes="144x144" href="/favicons/apple-icon-144x144.png">
        <link rel="apple-touch-icon" sizes="152x152" href="/favicons/apple-icon-152x152.png">
        <link rel="apple-touch-icon" sizes="180x180" href="/favicons/apple-icon-180x180.png">
        <link rel="icon" type="image/png" sizes="192x192"  href="/favicons/android-icon-192x192.png">
        <link rel="icon" type="image/png" sizes="32x32" href="/favicons/favicon-32x32.png">
        <link rel="icon" type="image/png" sizes="96x96" href="/favicons/favicon-96x96.png">
        <link rel="icon" type="image/png" sizes="16x16" href="/favicons/favicon-16x16.png">
        <link rel="manifest" href="/manifest.json">
        <meta name="msapplication-TileColor" content="#ffffff">
        <meta name="msapplication-TileImage" content="/favicons/ms-icon-144x144.png">
        <meta name="theme-color" content="#ffffff">`;

        // preload images when applicable
        h += `<link rel="preload" as="image" href="./images/wallpaper.webp">`;
    h += `</head>`;
    
    h += `<body>`;

        // To indicate that the GUI is running to any 3rd-party scripts that may be running on the page
        // specifically, the `puter.js` script
        // This line is also present verbatim in `src/index.js` for production builds
        h += `<script>window.puter_gui_enabled = true;</script>`;

        // DEV: load every JS library individually
        if(options.env === 'dev'){
            for(let i = 0; i < lib_paths.length; i++){
                h += `<script src="${lib_paths[i]}"></script>`;
            }
        }
        
        // load images and icons as base64 for performance
        if(options.env === 'dev'){
            h += `<script>`;
                h += `window.icons = {};`
                fs.readdirSync(path.join(__dirname, 'src/icons')).forEach(file => {
                    // skip dotfiles
                    if(file.startsWith('.'))
                        return;
                    // load image
                    let buff = new Buffer.from(fs.readFileSync(path.join(__dirname, 'src/icons') + '/' + file));
                    // convert to base64
                    let base64data = buff.toString('base64');
                    // add to `window.icons`
                    if(file.endsWith('.png'))
                        h += `window.icons['${file}'] = "data:image/png;base64,${base64data}";\n`;
                    else if(file.endsWith('.svg'))
                        h += `window.icons['${file}'] = "data:image/svg+xml;base64,${base64data}";\n`;
                });
            h += `</script>`;
        }


        // PROD: gui.js
        if(options.env === 'prod'){
            h += `<script src="/dist/gui.js"></script>`;
        }
        // DEV: load every JS file individually
        else{
            for(let i = 0; i < js_paths.length; i++){
                h += `<script type="module" src="${js_paths[i]}"></script>`;
            }
            // load GUI
            h += `<script type="module" src="/index.js"></script>`;
        }

        // ----------------------------------------
        // Initialize GUI with config options
        // ----------------------------------------
        h += `
        <script type="text/javascript">
        window.addEventListener('load', function() {`
            h += `gui()`;
        h += `});
        </script>`;

    h += `</body>
    
    </html>`;  
    
    console.log(`/index.js: ` + (Date.now() - start_t)/1000);
    return h;
}

// export
export { generateDevHtml, build };
