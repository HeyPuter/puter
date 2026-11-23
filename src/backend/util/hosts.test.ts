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
import { getPuterHostedDomains, normalizeHost } from './hosts';

describe('normalizeHost', () => {
    it('trims, lowercases and drops a leading dot and the port', () => {
        expect(normalizeHost('  .Puter.Site:443 ')).toBe('puter.site');
    });

    it('keeps the port when asked', () => {
        expect(normalizeHost('.Dev.Puter.Localhost:4100', { keepPort: true })).toBe(
            'dev.puter.localhost:4100',
        );
    });

    it('returns null for non-strings and empty values', () => {
        expect(normalizeHost(undefined)).toBeNull();
        expect(normalizeHost(42)).toBeNull();
        expect(normalizeHost('   ')).toBeNull();
        expect(normalizeHost('.')).toBeNull();
        expect(normalizeHost(':4100')).toBeNull();
    });
});

describe('getPuterHostedDomains', () => {
    it('collects, normalizes, and dedupes the configured domains', () => {
        expect(
            getPuterHostedDomains({
                static_hosting_domain: '  .Puter.Site  ',
                static_hosting_domain_alt: 'puter.site',
                private_app_hosting_domain: 'private.puter.localhost:4100',
            }).sort(),
        ).toEqual(['private.puter.localhost', 'puter.site']);
    });

    it('adds the configured form with its port when asked', () => {
        expect(
            getPuterHostedDomains(
                {
                    static_hosting_domain: 'puter.site',
                    private_app_hosting_domain: 'App.Puter.Localhost:4100',
                },
                { withPorts: true },
            ).sort(),
        ).toEqual([
            'app.puter.localhost',
            'app.puter.localhost:4100',
            'puter.site',
        ]);
    });

    it('ignores absent and non-string config values', () => {
        expect(getPuterHostedDomains(undefined)).toEqual([]);
        expect(getPuterHostedDomains(null)).toEqual([]);
        expect(
            getPuterHostedDomains({
                static_hosting_domain: '',
                static_hosting_domain_alt: 42,
            }),
        ).toEqual([]);
    });
});
