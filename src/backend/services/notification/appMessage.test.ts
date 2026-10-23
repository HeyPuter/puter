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
import { appMessageSender, parseAppMessage } from './appMessage.js';

/** The 400 a field failing validation raises. */
const rejects = (input: Record<string, unknown>, field: string) =>
    expect(() => parseAppMessage(input)).toThrow(
        expect.objectContaining({
            statusCode: 400,
            legacyCode: 'bad_request',
            fields: { field },
        }),
    );

describe('parseAppMessage', () => {
    it('fills in the defaults around a bare title', () => {
        expect(parseAppMessage({ title: '  Hello  ' })).toEqual({
            title: 'Hello',
            priority: 'normal',
            ttl: 3600,
        });
    });

    it('keeps every field of a full message', () => {
        const input = {
            title: 'New reply',
            text: '<b>not markup</b>, stored as text',
            icon: 'https://example.com/icon.png',
            target: '/chat/42?from=notif#latest',
            data: { thread: 42, tags: ['a'] },
            group: 'chat:42',
            channel: 'replies',
            sensitive: true,
            priority: 'normal',
            ttl: 86_400,
        };
        expect(parseAppMessage(input)).toEqual(input);
    });

    it('requires a non-empty string title', () => {
        rejects({}, 'title');
        rejects({ title: 7 }, 'title');
        rejects({ title: '   ' }, 'title');
    });

    it('caps the title at 120 characters, counting an emoji once', () => {
        expect(parseAppMessage({ title: '😀'.repeat(120) }).title).toBe(
            '😀'.repeat(120),
        );
        rejects({ title: 'x'.repeat(121) }, 'title');
    });

    it('caps text at 240 characters', () => {
        expect(
            parseAppMessage({ title: 't', text: 'x'.repeat(240) }).text,
        ).toHaveLength(240);
        rejects({ title: 't', text: 'x'.repeat(241) }, 'text');
        rejects({ title: 't', text: 5 }, 'text');
    });

    it('drops invisible formatting marks and controls from title and text', () => {
        const marks = '\u202e\u2066\u200b\u200d\ufeff\u0007\u0085';
        expect(
            parseAppMessage({
                title: `Pay${marks}ment\ndue`,
                text: `line one${marks}\r\nline two\tend`,
            }),
        ).toMatchObject({
            title: 'Payment due',
            text: 'line one\nline twoend',
        });
    });

    it('leaves out text with nothing visible in it', () => {
        expect(
            parseAppMessage({ title: 't', text: ' \n\u200b ' }),
        ).not.toHaveProperty('text');
    });

    it('rejects a title made only of invisible marks', () => {
        rejects({ title: '\u200b\u202e\u0000' }, 'title');
    });

    it('stores the icon as a normalized URL', () => {
        expect(
            parseAppMessage({ title: 't', icon: 'HTTPS://Example.COM/a b.png' })
                .icon,
        ).toBe('https://example.com/a%20b.png');
    });

    it('takes only an https icon', () => {
        rejects({ title: 't', icon: 'http://example.com/a.png' }, 'icon');
        rejects({ title: 't', icon: 'data:image/png;base64,AAAA' }, 'icon');
        rejects({ title: 't', icon: 'javascript:alert(1)' }, 'icon');
        rejects({ title: 't', icon: '/relative.png' }, 'icon');
        rejects(
            { title: 't', icon: `https://example.com/${'x'.repeat(2048)}` },
            'icon',
        );
    });

    it('takes only a path inside the app as the target', () => {
        rejects({ title: 't', target: 'chat/42' }, 'target');
        rejects({ title: 't', target: 'https://example.com/' }, 'target');
        rejects({ title: 't', target: '//example.com/' }, 'target');
        rejects({ title: 't', target: '/\\example.com/' }, 'target');
        rejects({ title: 't', target: '/a b' }, 'target');
        rejects({ title: 't', target: '/a/../b' }, 'target');
        rejects({ title: 't', target: '/a/./b' }, 'target');
        rejects({ title: 't', target: '/a/%2e%2E/b' }, 'target');
        rejects({ title: 't', target: '/..' }, 'target');
        rejects({ title: 't', target: '/caf\u00e9' }, 'target');
        expect(
            parseAppMessage({ title: 't', target: '/a/..b/c?x=../y#..' })
                .target,
        ).toBe('/a/..b/c?x=../y#..');
        rejects({ title: 't', target: `/${'x'.repeat(512)}` }, 'target');
    });

    it('caps serialized data at 1024 bytes', () => {
        const fits = { blob: 'x'.repeat(1024 - '{"blob":""}'.length) };
        expect(parseAppMessage({ title: 't', data: fits }).data).toEqual(fits);
        rejects({ title: 't', data: { blob: 'x'.repeat(1024) } }, 'data');
    });

    it('limits group to 64 characters of a small charset', () => {
        expect(
            parseAppMessage({ title: 't', group: 'Chat_1.thread:2-a' }).group,
        ).toBe('Chat_1.thread:2-a');
        rejects({ title: 't', group: 'has space' }, 'group');
        rejects({ title: 't', group: '' }, 'group');
        rejects({ title: 't', group: 'x'.repeat(65) }, 'group');
    });

    it('limits channel to 32 lowercase letters, digits and dashes', () => {
        expect(
            parseAppMessage({ title: 't', channel: 'new-reply-2' }).channel,
        ).toBe('new-reply-2');
        rejects({ title: 't', channel: 'Replies' }, 'channel');
        rejects({ title: 't', channel: 'a_b' }, 'channel');
        rejects({ title: 't', channel: 'x'.repeat(33) }, 'channel');
    });

    it('takes a boolean for sensitive', () => {
        rejects({ title: 't', sensitive: 'yes' }, 'sensitive');
    });

    it('refuses high priority to apps', () => {
        expect(() => parseAppMessage({ title: 't', priority: 'high' })).toThrow(
            "'high' is not available to apps",
        );
        rejects({ title: 't', priority: 'urgent' }, 'priority');
    });

    it('bounds ttl to whole seconds within a day', () => {
        expect(parseAppMessage({ title: 't', ttl: 1 }).ttl).toBe(1);
        rejects({ title: 't', ttl: 0 }, 'ttl');
        rejects({ title: 't', ttl: 86_401 }, 'ttl');
        rejects({ title: 't', ttl: 1.5 }, 'ttl');
        rejects({ title: 't', ttl: '60' }, 'ttl');
    });

    it('rejects a field the format does not have', () => {
        rejects({ title: 't', body: 'x' }, 'body');
        rejects({ title: 't', app: { uid: 'a', name: 'Other' } }, 'app');
    });
});

describe('appMessageSender', () => {
    it('names the app by its title, else its name, and keeps an https icon', () => {
        expect(
            appMessageSender('app-1', {
                name: 'chat',
                title: 'Chat',
                icon: 'https://example.com/i.png',
            }),
        ).toEqual({
            uid: 'app-1',
            name: 'Chat',
            icon: 'https://example.com/i.png',
        });
        expect(appMessageSender('app-1', { name: 'chat', title: '' })).toEqual({
            uid: 'app-1',
            name: 'chat',
        });
    });

    it('leaves out an icon that is not an https URL', () => {
        expect(
            appMessageSender('app-1', {
                name: 'chat',
                icon: 'data:image/png;base64,AAAA',
            }),
        ).toEqual({ uid: 'app-1', name: 'chat' });
        expect(appMessageSender('app-1', null)).toEqual({ uid: 'app-1' });
    });
});
