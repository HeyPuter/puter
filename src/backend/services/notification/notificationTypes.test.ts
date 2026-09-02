/**
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
    NOTIFICATION_TYPES,
    findNotificationType,
    resolveNotificationWrite,
} from './notificationTypes.js';

describe('NOTIFICATION_TYPES', () => {
    it('names every type exactly once', () => {
        const names = NOTIFICATION_TYPES.map((entry) => entry.type);
        expect(new Set(names).size).toBe(names.length);
    });

    it('keeps account rows off apps entirely', () => {
        for (const entry of NOTIFICATION_TYPES) {
            if (entry.audience !== 'account') continue;
            expect(entry.appScoped).toBe(false);
        }
    });

    it('only app-scoped audiences may require an app', () => {
        for (const entry of NOTIFICATION_TYPES) {
            if (!entry.appScoped) continue;
            expect(['developer', 'app-user']).toContain(entry.audience);
        }
    });

    it('carries the types the events work will emit', () => {
        // A handler that keeps failing is the developer's problem; a
        // subscription that ended is the holder's.
        expect(findNotificationType('app.events.suspended')).toMatchObject({
            audience: 'developer',
            appScoped: true,
        });
        expect(findNotificationType('app.events.ended')).toMatchObject({
            audience: 'app-user',
            appScoped: false,
        });
    });

    it('projects a subject naming the app, or the recipient when there is none', () => {
        const account = findNotificationType('share.received')!;
        expect(
            account.subject({ userUuid: 'user-uuid', appUid: null }),
        ).toBe('notif:user-uuid:account');

        const developer = findNotificationType('app.events.suspended')!;
        expect(
            developer.subject({ userUuid: 'user-uuid', appUid: 'app-1' }),
        ).toBe('notif:app-1:developer');

        const holder = findNotificationType('app.events.ended')!;
        expect(holder.subject({ userUuid: 'user-uuid', appUid: 'app-1' })).toBe(
            'notif:app-1:app-user',
        );

        // A worker bound to no app has no app to name.
        const worker = findNotificationType('app.worker.deployed')!;
        expect(worker.subject({ userUuid: 'user-uuid', appUid: null })).toBe(
            'notif:user-uuid:developer',
        );
    });
});

describe('resolveNotificationWrite', () => {
    it('returns the entry for a legal write', () => {
        expect(resolveNotificationWrite('share.received', null).audience).toBe(
            'account',
        );
        expect(
            resolveNotificationWrite('app.events.suspended', 'app-1').audience,
        ).toBe('developer');
        // Not app-scoped, but carries the app where one is known.
        expect(
            resolveNotificationWrite('app.worker.deployed', 'app-1').audience,
        ).toBe('developer');
        expect(
            resolveNotificationWrite('app.worker.deployed', null).audience,
        ).toBe('developer');
    });

    it('rejects an unregistered type', () => {
        expect(() => resolveNotificationWrite('share.invented', null)).toThrow(
            'not registered',
        );
        expect(() => resolveNotificationWrite('', null)).toThrow(
            'not registered',
        );
    });

    it('rejects an app uid on an account type', () => {
        expect(() =>
            resolveNotificationWrite('share.received', 'app-1'),
        ).toThrow('cannot name an app');
    });

    it('rejects an app-scoped type with no app uid', () => {
        expect(() =>
            resolveNotificationWrite('app.events.suspended', null),
        ).toThrow('requires an app uid');
        expect(() =>
            resolveNotificationWrite('app.events.suspended', ''),
        ).toThrow('requires an app uid');
    });

    it('lets a subscription an account made end without naming an app', () => {
        expect(resolveNotificationWrite('app.events.ended', null).audience).toBe(
            'app-user',
        );
    });
});
