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

import { describe, expect, it } from 'vitest';
import { parseAppGrantablePermission } from './appGrantable.js';

const ME = '2f5d8a8e-6b8f-4a43-9a0b-3d6f3f0f9b11';
const OTHER = '9c1e4b7a-1f2d-4c3b-8a5e-6d7f8091a2b3';
const APP = 'app-5d4f2c1e-8b3a-4f6d-9e7c-1a2b3c4d5e6f';
const FILE = 'b3c1d2e4-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const parse = (permission: string) =>
    parseAppGrantablePermission(permission, ME);

describe('parseAppGrantablePermission', () => {
    it.each([
        [
            `fs:/alice/Documents:read`,
            { family: 'fs', target: '/alice/Documents', mode: 'read' },
        ],
        [`fs:${FILE}:write`, { family: 'fs', target: FILE, mode: 'write' }],
        [
            `fs:/alice/a\\Cb.txt:see`,
            { family: 'fs', target: '/alice/a:b.txt', mode: 'see' },
        ],
        [
            `fs:/alice/a\\\\b.txt:read`,
            { family: 'fs', target: '/alice/a\\b.txt', mode: 'read' },
        ],
        [`fs:/alice:list`, { family: 'fs', target: '/alice', mode: 'list' }],
        [`user:${ME}:email:read`, { family: 'email' }],
        [`apps-of-user:${ME}:read`, { family: 'apps', access: 'read' }],
        [
            `subdomains-of-user:${ME}:write`,
            { family: 'subdomains', access: 'write' },
        ],
        [`app-data:${APP}`, { family: 'appData', appUid: APP }],
        [`app-data:${APP}:kv`, { family: 'appData', appUid: APP, store: 'kv' }],
        [
            `app-data:${APP}:kv:expireAt`,
            { family: 'appData', appUid: APP, store: 'kv', scope: 'expireAt' },
        ],
        [
            `app-data:${APP}:fs:delete`,
            { family: 'appData', appUid: APP, store: 'fs', scope: 'delete' },
        ],
        [
            `app-root-dir:${APP}:write`,
            { family: 'appRootDir', appUid: APP, access: 'write' },
        ],
        [
            `manage:kv-share:${ME}:${APP}:rooms:abc`,
            {
                family: 'kvShare',
                level: 'watch',
                ownerUuid: ME,
                appUid: APP,
                segments: ['rooms', 'abc'],
            },
        ],
        [
            `manage:kv-share-read:${ME}:${APP}:rooms:abc`,
            {
                family: 'kvShare',
                level: 'read',
                ownerUuid: ME,
                appUid: APP,
                segments: ['rooms', 'abc'],
            },
        ],
        [
            `manage:kv-share-write:${ME}:${APP}:rooms`,
            {
                family: 'kvShare',
                level: 'write',
                ownerUuid: ME,
                appUid: APP,
                segments: ['rooms'],
            },
        ],
        ['events:background', { family: 'backgroundEvents' }],
    ])('accepts %s', (permission, parsed) => {
        expect(parse(permission)).toEqual(parsed);
    });

    it.each([
        // Never checked for an app, so a grant would only confuse the prompt.
        'service:ai-chat:ii:puter-chat-completion',
        'driver:puter-image-generation:generate',
        'thread:abc:post',
        'site:example',
        'feature',
        // Internal or wider than any prompt can describe.
        `manage:fs:${FILE}:write`,
        `manage:fs:/alice/Documents`,
        `kv-share:${ME}:${APP}:rooms`,
        `kv-share-read:${ME}:${APP}:rooms`,
        `kv-share-write:${ME}:${APP}:rooms`,
        `app:uid#${APP}:access`,
        'flag:app-is-authenticated',
        'full-api-access',
        '*',
        'events',
        'events:background:extra',
        // Modeless, or a mode that does not exist.
        'fs',
        `fs:${FILE}`,
        `fs:${FILE}:delete`,
        `fs:${FILE}:read:extra`,
        'fs:relative/path:read',
        'fs:not-a-uuid:read',
        // Another user's data.
        `user:${OTHER}:email:read`,
        `apps-of-user:${OTHER}:read`,
        `subdomains-of-user:${OTHER}:write`,
        `manage:kv-share:${OTHER}:${APP}:rooms`,
        `manage:kv-share-read:${OTHER}:${APP}:rooms`,
        `manage:kv-share-write:${OTHER}:${APP}:rooms`,
        // Shape errors inside an allowed family.
        `user:${ME}:email`,
        `user:${ME}:email:write`,
        `apps-of-user:${ME}`,
        `apps-of-user:${ME}:manage`,
        'app-data',
        'app-data:',
        `app-data:${APP}:sql:read`,
        `app-data:${APP}:kv:flush`,
        `app-data:${APP}:fs:get`,
        `app-data:${APP}:kv:get:extra`,
        'app-data:app-nope/:kv:read',
        'app-data:not-an-app:kv:read',
        `app-data:${APP}:`,
        `app-data:${APP}:kv:`,
        `app-data:${APP}::read`,
        `app-root-dir:${APP}`,
        `app-root-dir:${APP}:delete`,
        'app-root-dir:not-an-app:read',
        `app-root-dir:${APP}:read:extra`,
        `apps-of-user:${ME}:read:extra`,
        // Spelled other than canonically, which later checks would not match.
        'f\\s:/x:read',
        'fs:/alice/a\\b.txt:read',
        `app-dat\\a:${APP}:kv:read`,
        `app-root-di\\r:${APP}:read`,
        `manag\\e:kv-share:${ME}:${APP}:rooms`,
        `manage:kv-shar\\e:${ME}:${APP}:rooms`,
        `manage:kv-share\\Crooms:${ME}:${APP}:abc`,
        'event\\s:background',
        `manage:kv-share:${ME}:${APP}`,
        `manage:kv-share:${ME}:${APP}:rooms::abc`,
        `manage:kv-share:${ME}:not-an-app:rooms`,
        `manage:kv-share-read:${ME}:${APP}`,
        `manage:kv-share-write:${ME}:${APP}:rooms::abc`,
        `manage:kv-share-delete:${ME}:${APP}:rooms`,
        // Prototype members are not families.
        `constructor:${ME}:read`,
        `manage:toString:${ME}:${APP}:rooms`,
        'random-string',
        '',
    ])('refuses %s', (permission) => {
        expect(parse(permission)).toBeNull();
    });
});
