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
const config = require('./config');
const { encode } = require('html-entities');

function html_head (options) {
    let canonical_url = `${config.origin}/${options.page === 'index' ? '' : options.page}`;
    let html = '';
    html += '<!doctype html>';
    html += `<html lang="en" id="html-${options.page ?? 'default'}">`;
    html += '<head>';
    // meta tags
    html += '<meta charset="utf-8">';
    html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
    html += `<meta name="description" content="${encode(options.meta_description ?? '')}">`;
    html += '<meta name="referrer" content="no-referrer">';
    // title
    html += `<title>${encode(options.title ?? 'Puter')}</title>`;
    // favicons
    html += `<link rel="apple-touch-icon" sizes="57x57" href="/img/favicons/apple-icon-57x57.png">
			<link rel="apple-touch-icon" sizes="60x60" href="/img/favicons/apple-icon-60x60.png">
			<link rel="apple-touch-icon" sizes="72x72" href="/img/favicons/apple-icon-72x72.png">
			<link rel="apple-touch-icon" sizes="76x76" href="/img/favicons/apple-icon-76x76.png">
			<link rel="apple-touch-icon" sizes="114x114" href="/img/favicons/apple-icon-114x114.png">
			<link rel="apple-touch-icon" sizes="120x120" href="/img/favicons/apple-icon-120x120.png">
			<link rel="apple-touch-icon" sizes="144x144" href="/img/favicons/apple-icon-144x144.png">
			<link rel="apple-touch-icon" sizes="152x152" href="/img/favicons/apple-icon-152x152.png">
			<link rel="apple-touch-icon" sizes="180x180" href="/img/favicons/apple-icon-180x180.png">
			<link rel="icon" type="image/png" sizes="192x192"  href="/img/favicons/android-icon-192x192.png">
			<link rel="icon" type="image/png" sizes="32x32" href="/img/favicons/favicon-32x32.png">
			<link rel="icon" type="image/png" sizes="96x96" href="/img/favicons/favicon-96x96.png">
			<link rel="icon" type="image/png" sizes="16x16" href="/img/favicons/favicon-16x16.png">
			<link rel="manifest" href="/manifest.json">
			<meta name="msapplication-TileColor" content="#ffffff">
			<meta name="msapplication-TileImage" content="/img/favicons/ms-icon-144x144.png">
			<meta name="theme-color" content="#ffffff">`;

    // Roboto font
    html += '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto:black,bold,medium,regular,light,thin">';

    // canonical link
    html += `<link rel="canonical" href="${canonical_url}" />`;

    // preload images
    if ( options.page === 'index' ) {
        html += '<link rel="preload" as="image" href="/assets/img/lock.svg"></link>';
        html += '<link rel="preload" as="image" href="/assets/img/screenshot.png"></link>';
    }

    // Facebook meta tags
    html += `<meta property="og:url" content="${canonical_url}">`;
    html += '<meta property="og:type" content="website">';
    html += `<meta property="og:title" content="${encode(options.title ?? 'Puter')}">`;
    html += `<meta property="og:description" content="${encode(config.short_description)}">`;
    html += `<meta property="og:image" content="${config.social_card}">`;

    // Twitter meta tags
    html += '<meta name="twitter:card" content="">';
    html += `<meta property="twitter:domain" content="${config.domain}">`;
    html += `<meta property="twitter:url" content="${canonical_url}">`;
    html += `<meta name="twitter:title" content="${encode(options.title ?? 'Puter')}">`;
    html += `<meta name="twitter:description" content="${encode(config.short_description)}">`;
    html += `<meta name="twitter:image" content="${config.social_card}">`;

    // CSS
    html += '<link href="/assets/bootstrap-5.1.3/css/bootstrap.min.css" rel="stylesheet"></link>';
    html += '<link href="/assets/css/style.css" rel="stylesheet"></link>';

    html += '</head>';
    html += `<body id="body-${options.page ?? 'default'}">`;
    if ( options.show_navbar ?? false ) {
        html += '<main>';
        html += '<div class="container">';
        html += '<header class="d-flex flex-wrap align-items-center justify-content-center justify-content-md-between py-3 mb-4 border-bottom">';
        html += '<div class="d-flex align-items-center col-md-3 mb-2 mb-md-0 text-dark text-decoration-none">';
        html += '<a href="/" class="text-dark text-decoration-none">';
        html += '<img class="bi me-2 logo" width="40" height="40" role="img" src="/assets/img/logo-128x128.png" style="margin-right: 0 !important;">';
        html += '</a>';
        html += '</div>';

        html += '<ul class="nav col-12 col-md-auto mb-2 justify-content-center mb-md-0">';
        html += '</ul>';

        html += '</header>';

        html += '</div>';
    }

    html += '';
    return html;
}
module.exports = html_head;