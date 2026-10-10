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
import { toAppView } from './appView.js';

const row = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    uid: 'app-1234',
    name: 'cool-app',
    title: 'Cool App',
    description: 'does things',
    icon: 'data:image/png;base64,AAA',
    index_url: 'https://cool-app.example.com/',
    owner_user_id: 7,
    background: 1,
    maximize_on_start: 0,
    feedback_enabled: 1,
    godmode: 0,
    is_private: 0,
    protected: 0,
    approved_for_listing: 1,
    approved_for_opening_items: 0,
    approved_for_incentive_program: 0,
    metadata: null,
    timestamp: 1650000000,
    ...overrides,
});

describe('toAppView', () => {
    it('maps the row to booleans and drops internal columns', () => {
        const view = toAppView(row(), ['txt']) as unknown as Record<
            string,
            unknown
        >;

        expect(view).toMatchObject({
            uid: 'app-1234',
            index_url: 'https://cool-app.example.com/',
            background: true,
            maximize_on_start: false,
            feedback_enabled: true,
            filetype_associations: ['txt'],
            created_at: 1650000000,
        });
        expect(view).not.toHaveProperty('id');
        expect(view).not.toHaveProperty('owner_user_id');
        expect(view).not.toHaveProperty('privateAccess');
    });

    it('withholds index_url when the private gate denies', () => {
        const denied = { hasAccess: false, reason: 'private-access-required' };
        const view = toAppView(row({ is_private: 1 }), [], {
            privateAccess: denied,
        });

        expect(view).not.toHaveProperty('index_url');
        expect(view.privateAccess).toBe(denied);
    });

    it('keeps index_url when the private gate allows', () => {
        const view = toAppView(row({ is_private: 1 }), [], {
            privateAccess: { hasAccess: true },
        });

        expect(view.index_url).toBe('https://cool-app.example.com/');
        expect(view.privateAccess).toEqual({ hasAccess: true });
    });

    it('denies a hosted app whose backing is gone, but its owner keeps the URL', () => {
        const forOther = toAppView(row(), [], {
            viewerUserId: 8,
            hostedBackingUnavailable: true,
        });
        const forOwner = toAppView(row(), [], {
            viewerUserId: 7,
            hostedBackingUnavailable: true,
        });

        expect(forOther).not.toHaveProperty('index_url');
        expect(forOther.privateAccess?.reason).toBe(
            'hosted_backing_unavailable',
        );
        expect(forOwner.index_url).toBe('https://cool-app.example.com/');
        expect(forOwner.privateAccess?.hasAccess).toBe(false);
    });

    it('keeps an existing private denial over the hosted one', () => {
        const denied = { hasAccess: false, reason: 'private-access-required' };
        const view = toAppView(row({ is_private: 1 }), [], {
            viewerUserId: 7,
            privateAccess: denied,
            hostedBackingUnavailable: true,
        });

        expect(view.privateAccess).toBe(denied);
        expect(view).not.toHaveProperty('index_url');
    });
});
