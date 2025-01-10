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
    'driver:puter-tts': {},
    'driver:puter-apps': {},
    'driver:puter-subdomains': {},
    'driver:temp-email': {},
    'service': {},
    'feature': {},
};

const implicit_user_app_permissions = [
    {
        id: 'builtin-apps',
        apps: [
            'app-0bef044f-918f-4cbf-a0c0-b4a17ee81085', // about
            'app-838dfbc4-bf8b-48c2-b47b-c4adc77fab58', // editor
            'app-58282b08-990a-4906-95f7-fa37ff92452b', // draw
            'app-3fea7529-266e-47d9-8776-31649cd06557', // terminal
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

const policy_perm = selector => ({
    policy: {
        $: 'json-address',
        path: '/admin/.policy/drivers.json',
        selector,
    }
});

const hardcoded_user_group_permissions = {
    system: {
        'ca342a5e-b13d-4dee-9048-58b11a57cc55': {
            'driver': {},
            'service': {},
            'feature': {},
            'kernel-info': {},
            'local-terminal:access': {},
        },
        'b7220104-7905-4985-b996-649fdcdb3c8f': {
            'service:hello-world:ii:hello-world': policy_perm('temp.es'),
            'service:puter-kvstore:ii:puter-kvstore': policy_perm('temp.kv'),
            'driver:puter-kvstore': policy_perm('temp.kv'),
            'service:puter-notifications:ii:crud-q': policy_perm('temp.es'),
            'service:puter-apps:ii:crud-q': policy_perm('temp.es'),
            'service:puter-subdomains:ii:crud-q': policy_perm('temp.es'),
            'service:es\\Cnotification:ii:crud-q': policy_perm('user.es'),
            'service:es\\Capp:ii:crud-q': policy_perm('user.es'),
            'service:es\\Csubdomain:ii:crud-q': policy_perm('user.es'),
        },
        '78b1b1dd-c959-44d2-b02c-8735671f9997': {
            'service:hello-world:ii:hello-world': policy_perm('user.es'),
            'service:puter-kvstore:ii:puter-kvstore': policy_perm('user.kv'),
            'driver:puter-kvstore': policy_perm('user.kv'),
            'service:es\\Cnotification:ii:crud-q': policy_perm('user.es'),
            'service:es\\Capp:ii:crud-q': policy_perm('user.es'),
            'service:es\\Csubdomain:ii:crud-q': policy_perm('user.es'),
        },
    },
};

module.exports = {
    implicit_user_app_permissions,
    default_implicit_user_app_permissions,
    hardcoded_user_group_permissions,
};
