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

function html_footer (options) {
    let html = '';
    if ( options.show_footer ?? false ) {
        html += '<div class="container">';
        html += '<footer class="row row-cols-5 py-5 my-5 border-top">';
        html += '<div class="col">';
        html += '<a href="/">';
        html += '<img src="/assets/img/logo-128x128.png" style="width:60px; border-radius: 4px; margin-bottom: 10px;">';
        html += '</a>';
        html += '<div><a href="mailto:hi@puter.com">hi@puter.com</a></div>';
        html += '</div>';

        html += '<div class="col">';
        html += '</div>';

        html += '<div class="col">';
        html += '</div>';

        html += '<div class="col">';
        html += '</div>';

        html += '<div class="col">';
        html += '<h5>Quick Links</h5>';
        html += '<ul class="nav flex-column">';
        html += '<li class="nav-item mb-2"><a href="/" class="nav-link p-0 text-muted">Home</a></li>';
        html += `<li class="nav-item mb-2"><a href="${ `${config.protocol }://blog.${ config.domain}`}" class="nav-link p-0 text-muted">Blog</a></li>`;
        html += '<li class="nav-item mb-2"><a href="/login" class="nav-link p-0 text-muted">Log In</a></li>';
        html += '<li class="nav-item mb-2"><a href="/terms" class="nav-link p-0 text-muted">Terms</a></li>';
        html += '<li class="nav-item mb-2"><a href="/privacy" class="nav-link p-0 text-muted">Privacy Policy</a></li>';
        html += '</ul>';
        html += '</div>';
        html += '</footer>';
        // social
        html += '<div style="margin-top:20px; padding-bottom: 20px; padding-top:10px; overflow:hidden; border-top:1px solid #CCC;">';
        html += `<p class="text-muted" style="float:left;">Puter Technologies Inc. © ${new Date().getFullYear()}</p>`;
        html += '<a href="https://github.com/HeyPuter" target="_blank"><img src="/img/logo-github.svg" class="social-media-icon"></a>';
        html += '<a href="https://www.facebook.com/HeyPuter"><img src="/img/logo-facebook.svg" target="_blank" class="social-media-icon"></a>';
        html += '<a href="https://twitter.com/HeyPuter" target="_blank"><img src="/img/logo-twitter.svg" class="social-media-icon"></a>';
        html += '</div>';
        html += '</div>';
        html += '</main>';
    }

    html += `<script>window.page = "${options.page ?? ''}"</script>`;
    html += '<script src="/assets/js/jquery-3.6.0/jquery-3.6.0.min.js"></script>';
    if ( options.jsfiles && options.jsfiles.length > 0 ) {
        options.jsfiles.forEach(jsfile => {
            html += `<script src="${jsfile}"></script>`;
        });
    }
    html += '<script src="/assets/js/app.js"></script>';
    html += '</body>';
    return html;
}
module.exports = html_footer;