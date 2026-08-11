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

const default_implicit_user_app_permissions = {
    'driver:helloworld:greet': {},
    'driver:puter-kvstore': {},
    'driver:puter-ocr:recognize': {},
    'driver:puter-chat-completion': {},
    'driver:puter-image-generation': {},
    'driver:puter-video-generation': {},
    'driver:puter-tts': {},
    'driver:puter-speech2speech': {},
    'driver:puter-speech2txt': {},
    'driver:puter-apps': {},
    'driver:puter-subdomains': {},
    'driver:temp-email': {},
    service: {},
    feature: {},
};

const implicit_user_app_permissions = [
    {
        id: 'builtin-apps',
        apps: [
            'app-0bef044f-918f-4cbf-a0c0-b4a17ee81085', // about
            'app-838dfbc4-bf8b-48c2-b47b-c4adc77fab58', // editor
            'app-58282b08-990a-4906-95f7-fa37ff92452b', // draw
            'app-5584fbf7-ed69-41fc-99cd-85da21b1ef51', // camera
            'app-7bdca1a4-6373-4c98-ad97-03ff2d608ca1', // recorder
            'app-240a43f4-43b1-49bc-b9fc-c8ae719dab77', // dev-center
            'app-a2ae72a4-1ba3-4a29-b5c0-6de1be5cf178', // app-center
            'app-74378e84-b9cd-5910-bcb1-3c50fa96d6e7', // https://nj.puter.site
            'app-13a38aeb-f9f6-54f0-9bd3-9d4dd655ccfe', // https://cdpn.io
            'app-dce8f797-82b0-5d95-a2f8-ebe4d71b9c54', // https://null.jsbin.com
            'app-93005ce0-80d1-50d9-9b1e-9c453c375d56', // https://markus.puter.com
        ],
        permissions: {
            'driver:helloworld:greet': {},
            'driver:puter-ocr:recognize': {},
            'driver:puter-kvstore:get': {},
            'driver:puter-kvstore:set': {},
            'driver:puter-kvstore:del': {},
            'driver:puter-kvstore:list': {},
            'driver:puter-kvstore:flush': {},
            'driver:puter-chat-completion:complete': {},
            'driver:puter-image-generation:generate': {},
            'driver:puter-video-generation:generate': {},
            'driver:puter-speech2speech:convert': {},
            'driver:puter-speech2txt:transcribe': {},
            'driver:puter-speech2txt:translate': {},
            'driver:puter-analytics:create_trace': {},
            'driver:puter-analytics:record': {},
        },
    },
    {
        id: 'local-testing',
        apps: [
            'app-a392f3e5-35ca-5dac-ae10-785696cc7dec', // https://localhost
            'app-a6263561-6a84-5d52-9891-02956f9fac65', // https://127.0.0.1
            'app-26149f0b-8304-5228-b995-772dadcf410e', // http://localhost
            'app-c2e27728-66d9-54dd-87cd-6f4e9b92e3e3', // http://127.0.0.1
        ],
        permissions: {
            'driver:helloworld:greet': {},
            'driver:puter-ocr:recognize': {},
            'driver:puter-kvstore:get': {},
            'driver:puter-kvstore:set': {},
            'driver:puter-kvstore:del': {},
            'driver:puter-kvstore:list': {},
            'driver:puter-kvstore:flush': {},
        },
    },
];

// Permissions every user actor holds, regardless of group membership.
//
// Roots only: a grant subsumes everything beneath it, so `service` already
// answers `service:puter-kvstore:ii:puter-kvstore`. Listing descendants adds
// entries no check can ever need.
//
// A floor, not a ceiling — anything that depends on *who* the user is belongs
// in the ACL as a `user_to_group_permissions` / `user_to_user_permissions`
// row. Adding a root here grants it to every user, temp accounts included.
const default_user_permissions = {
    driver: {},
    service: {},
};

module.exports = {
    implicit_user_app_permissions,
    default_implicit_user_app_permissions,
    default_user_permissions,
};
