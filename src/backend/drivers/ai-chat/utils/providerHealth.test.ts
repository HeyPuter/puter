/**
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, either version 3 of the License, or (at your option) any
 * later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see
 * [https://www.gnu.org/licenses/](https://www.gnu.org/licenses/).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { kv } from '../../../util/kvSingleton.js';
import {
    clearUnhealthyRoutes,
    isRouteUnhealthy,
    markRouteUnhealthy,
    UNHEALTHY_TTL_SEC,
} from './providerHealth.js';

afterEach(() => clearUnhealthyRoutes());

describe('providerHealth', () => {
    it('reports an unmarked route as healthy', () => {
        expect(isRouteUnhealthy('gemini', 'gemini-2.5-flash')).toBe(false);
    });

    it('marks one route without touching the same model elsewhere', () => {
        markRouteUnhealthy('gemini', 'gemini-2.5-flash');

        expect(isRouteUnhealthy('gemini', 'gemini-2.5-flash')).toBe(true);
        // The whole point of the fallback chain: another provider still
        // serves this model.
        expect(
            isRouteUnhealthy('infron', 'infron:google/gemini-2.5-flash'),
        ).toBe(false);
    });

    it('marks one model without taking the rest of the provider out', () => {
        markRouteUnhealthy('openai-completion', 'gpt-4o');

        expect(isRouteUnhealthy('openai-completion', 'gpt-4o')).toBe(true);
        expect(isRouteUnhealthy('openai-completion', 'gpt-4o-mini')).toBe(
            false,
        );
    });

    it('expires the mark rather than needing a reset path', () => {
        expect(UNHEALTHY_TTL_SEC).toBeGreaterThanOrEqual(5 * 60);
        expect(UNHEALTHY_TTL_SEC).toBeLessThanOrEqual(15 * 60);

        markRouteUnhealthy('groq', 'llama-3.3-70b');
        const ttl = kv.ttl('aiChat:unhealthyRoute:groq:llama-3.3-70b');
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(UNHEALTHY_TTL_SEC);
    });

    it('forgets the route once the mark has expired', () => {
        markRouteUnhealthy('xai', 'grok-4');
        expect(isRouteUnhealthy('xai', 'grok-4')).toBe(true);

        kv.expire('aiChat:unhealthyRoute:xai:grok-4', -1);
        expect(isRouteUnhealthy('xai', 'grok-4')).toBe(false);
    });

    it('clears every mark at once', () => {
        markRouteUnhealthy('gemini', 'gemini-2.5-flash');
        markRouteUnhealthy('claude', 'claude-sonnet-4');

        clearUnhealthyRoutes();

        expect(isRouteUnhealthy('gemini', 'gemini-2.5-flash')).toBe(false);
        expect(isRouteUnhealthy('claude', 'claude-sonnet-4')).toBe(false);
    });
});
