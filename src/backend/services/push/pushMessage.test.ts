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
import {
    buildPushMessage,
    fitPushMessage,
    PUSH_MESSAGE_MAX_BYTES,
} from './pushMessage.js';
import type { PushMessage } from './types.js';

const app = { uid: 'app-uid-1', name: 'Chat' };
const bytes = (message: PushMessage): number =>
    Buffer.byteLength(JSON.stringify(message), 'utf8');

describe('buildPushMessage', () => {
    it('names the sender and the item for one named share', () => {
        const message = buildPushMessage(
            {
                uid: 'n1',
                type: 'share.received',
                value: {
                    title: 'alice shared an item with you',
                    fields: {
                        username: 'alice',
                        count: 1,
                        senders: [{ username: 'alice', count: 1 }],
                        target: {
                            path: '/alice/Shared/report.txt',
                            name: 'report.txt',
                        },
                    },
                },
            },
            null,
        );
        expect(message).toEqual({
            uid: 'n1',
            title: 'alice shared report.txt',
            group: 'n1',
            target: { path: '/alice/Shared/report.txt' },
            ttl: 3600,
            priority: 'normal',
        });
    });

    it('uses the stored title for several items or senders', () => {
        const message = buildPushMessage(
            {
                uid: 'n2',
                type: 'share.received',
                value: {
                    title: 'alice and bob shared 3 items with you',
                    fields: {
                        senders: [
                            { username: 'alice', count: 2 },
                            { username: 'bob', count: 1 },
                        ],
                    },
                },
            },
            null,
        );
        expect(message?.title).toBe('alice and bob shared 3 items with you');
        expect(message?.target).toBeUndefined();
    });

    it('uses the stored title for share.claimed and developer types', () => {
        for (const type of [
            'share.claimed',
            'app.worker.deployed',
            'app.worker.deployFailed',
            'app.events.ended',
            'app.events.suspended',
        ]) {
            const message = buildPushMessage(
                { uid: 'n3', type, value: { title: `title of ${type}` } },
                null,
            );
            expect(message?.title).toBe(`title of ${type}`);
            expect(message?.group).toBe('n3');
            expect(message?.target).toBeUndefined();
        }
    });

    it('carries an app message with its group, target and data', () => {
        const message = buildPushMessage(
            {
                uid: 'n4',
                type: 'app.message',
                value: {
                    title: 'New reply',
                    text: 'see you at 5',
                    icon: 'https://chat.example/icon.png',
                    target: '/rooms/7',
                    data: { room: 7 },
                    group: 'room-7',
                    priority: 'normal',
                    ttl: 120,
                },
            },
            app,
        );
        expect(message).toEqual({
            uid: 'n4',
            title: 'New reply',
            body: 'see you at 5',
            icon: 'https://chat.example/icon.png',
            group: 'room-7',
            target: { app: 'app-uid-1', path: '/rooms/7' },
            data: { room: 7 },
            ttl: 120,
            priority: 'normal',
        });
    });

    it('groups an app message by its uid without a group', () => {
        const message = buildPushMessage(
            { uid: 'n5', type: 'app.message', value: { title: 'hi' } },
            app,
        );
        expect(message?.group).toBe('n5');
        expect(message?.target).toEqual({ app: 'app-uid-1' });
    });

    it('replaces a sensitive app message with a generic one', () => {
        const message = buildPushMessage(
            {
                uid: 'n6',
                type: 'app.message',
                value: {
                    title: 'Code 123456',
                    text: 'your login code',
                    icon: 'https://chat.example/icon.png',
                    target: '/codes/1',
                    data: { code: 123456 },
                    sensitive: true,
                    ttl: 60,
                },
            },
            app,
        );
        expect(message).toEqual({
            uid: 'n6',
            title: 'Chat',
            body: 'New notification from Chat',
            group: 'n6',
            target: { app: 'app-uid-1' },
            ttl: 60,
            priority: 'normal',
            sensitive: true,
        });
    });

    it('has nothing for an unknown type or a missing title', () => {
        expect(
            buildPushMessage(
                { uid: 'x', type: 'other', value: { title: 't' } },
                null,
            ),
        ).toBeNull();
        expect(
            buildPushMessage(
                { uid: 'x', type: 'share.claimed', value: {} },
                null,
            ),
        ).toBeNull();
        expect(
            buildPushMessage(
                { uid: 'x', type: 'app.message', value: { title: 't' } },
                null,
            ),
        ).toBeNull();
    });
});

describe('fitPushMessage', () => {
    const base: PushMessage = {
        uid: 'u',
        title: 'title',
        group: 'u',
        ttl: 60,
        priority: 'normal',
    };

    it('leaves a message under the budget alone', () => {
        const message = { ...base, body: 'short' };
        expect(fitPushMessage(message)).toBe(message);
    });

    it('shortens a long body to fit, by whole characters', () => {
        const fitted = fitPushMessage({ ...base, body: '😀'.repeat(2000) });
        expect(fitted).not.toBeNull();
        expect(bytes(fitted!)).toBeLessThanOrEqual(PUSH_MESSAGE_MAX_BYTES);
        expect(fitted!.title).toBe('title');
        expect(fitted!.body!.endsWith('…')).toBe(true);
        expect(
            Array.from(fitted!.body!.slice(0, -1)).every((c) => c === '😀'),
        ).toBe(true);
    });

    it('shortens the title once the body is gone, then drops the icon', () => {
        const titled = fitPushMessage({
            ...base,
            title: 't'.repeat(5000),
            body: 'b'.repeat(100),
        });
        expect(titled!.body).toBeUndefined();
        expect(bytes(titled!)).toBeLessThanOrEqual(PUSH_MESSAGE_MAX_BYTES);

        const iconless = fitPushMessage({
            ...base,
            icon: `https://x.example/${'i'.repeat(3000)}`,
            data: { blob: 'd'.repeat(1500) },
        });
        expect(iconless).not.toBeNull();
        expect(iconless!.icon).toBeUndefined();
        expect(iconless!.title).toBe('title');
    });

    it('never cuts data: too much of it and there is no push', () => {
        expect(
            fitPushMessage({ ...base, data: { blob: 'd'.repeat(4000) } }),
        ).toBeNull();
    });
});
