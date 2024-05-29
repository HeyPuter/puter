/**
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

// Ordered list of statically-linked external JS libraries and scripts
const lib_paths =[
    `/lib/jquery-3.6.1/jquery-3.6.1.min.js`,
    `/lib/viselect.min.js`,
    `/lib/FileSaver.min.js`,
    `/lib/socket.io/socket.io.min.js`,
    `/lib/qrcode.min.js`,
    `/lib/jquery-ui-1.13.2/jquery-ui.min.js`,
    `/lib/lodash@4.17.21.min.js`,
    `/lib/jquery.dragster.js`,
    '/lib/jquery.menu-aim.js',
    `/lib/html-entities.js`,
    `/lib/timeago.min.js`,
    `/lib/iro.min.js`,
    `/lib/isMobile.min.js`,
    `/lib/jszip-3.10.1.min.js`,
]

// Ordered list of CSS stylesheets
const css_paths = [
    '/css/normalize.css',
    '/lib/jquery-ui-1.13.2/jquery-ui.min.css',
    '/css/style.css',
]

// Ordered list of JS scripts
const js_paths = [
    '/init_sync.js',
    '/init_async.js',
    '/initgui.js',
    '/helpers.js',
    '/IPC.js',
    '/globals.js',
    `/i18n/i18n.js`,
]

export { lib_paths, css_paths, js_paths };