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
const {encode} = require('html-entities');
const path_ = require('path');
const fs_ = require('fs');

const generate_puter_page_html = ({
    manifest,
    gui_path,

    app_origin,
    api_origin,

    meta,

    gui_params,
}) => {
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
        app_origin,
        api_origin,
        gui_origin: app_origin,
    };

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
    <meta property="og:image" content="/dist/images/screenshot.png">

    <!-- Twitter meta tags -->
    <meta name="twitter:card" content="summary_large_image">
    <meta property="twitter:domain" content="puter.com">
    <meta property="twitter:url" content="${app_origin}">
    <meta name="twitter:title" content="${e(title)}">
    <meta name="twitter:description" content="${e((short_description).replace(/\n/g, " "))}">
    <meta name="twitter:image" content="/dist/images/screenshot.png">

    <!-- favicons -->
    <link rel="apple-touch-icon" sizes="57x57" href="/dist/favicons/apple-icon-57x57.png">
    <link rel="apple-touch-icon" sizes="60x60" href="/dist/favicons/apple-icon-60x60.png">
    <link rel="apple-touch-icon" sizes="72x72" href="/dist/favicons/apple-icon-72x72.png">
    <link rel="apple-touch-icon" sizes="76x76" href="/dist/favicons/apple-icon-76x76.png">
    <link rel="apple-touch-icon" sizes="114x114" href="/dist/favicons/apple-icon-114x114.png">
    <link rel="apple-touch-icon" sizes="120x120" href="/dist/favicons/apple-icon-120x120.png">
    <link rel="apple-touch-icon" sizes="144x144" href="/dist/favicons/apple-icon-144x144.png">
    <link rel="apple-touch-icon" sizes="152x152" href="/dist/favicons/apple-icon-152x152.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/dist/favicons/apple-icon-180x180.png">
    <link rel="icon" type="image/png" sizes="192x192"  href="/dist/favicons/android-icon-192x192.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/dist/favicons/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="96x96" href="/dist/favicons/favicon-96x96.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/dist/favicons/favicon-16x16.png">
    <link rel="manifest" href="/dist/manifest.json">
    <meta name="msapplication-TileColor" content="#ffffff">
    <meta name="msapplication-TileImage" content="/dist/favicons/ms-icon-144x144.png">
    <meta name="theme-color" content="#ffffff">

    <!-- Preload images when applicable -->
    <link rel="preload" as="image" href="/dist/images/wallpaper.webp">

    <!-- Files from JSON (may be empty) -->
    ${
        (manifest?.css_paths
            ? manifest.css_paths.map(path => `<link rel="stylesheet" href="${path}">\n`)
            : []).join('')
    }
    <!-- END Files from JSON -->
</head>

<body>
    <script>window.puter_gui_enabled = true;</script>
    ${
        (manifest?.lib_paths
            ? manifest.lib_paths.map(path => `<script type="text/javascript" src="${path}"></script>\n`)
            : []).join('')
    }

    <script>
    window.icons = {};

    ${(() => {
        if ( ! manifest ) return '';
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
        (manifest?.js_paths
            ? manifest.js_paths.map(path => `<script type="module" src="${path}"></script>\n`)
            : []).join('')
    }
    <!-- Load the GUI script -->
    <script ${ manifest.index ? ' type="module"' : ''} src="${manifest?.index ?? '/dist/gui.js'}"></script>
    <!-- Initialize GUI when document is loaded -->
    <script>
    window.addEventListener('load', function() {
        gui(${JSON.stringify(gui_params)});
    });
    </script>
    <div id="templates" style="display: none;"></div>
</body>

</html>`;
};

module.exports = {
    generate_puter_page_html,
};
