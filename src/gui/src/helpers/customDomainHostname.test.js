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

import { describe, it, expect } from 'vitest';
import { isPlausibleHostname, normalizeHostnameInput } from './customDomainHostname.js';

describe('normalizeHostnameInput', () => {
    it('keeps a bare hostname, lowercased and trimmed', () => {
        expect(normalizeHostnameInput('  WWW.Example.com ')).toBe('www.example.com');
    });

    it('strips a pasted URL down to its hostname', () => {
        expect(normalizeHostnameInput('https://www.example.com/about?x=1#top')).toBe('www.example.com');
        expect(normalizeHostnameInput('http://example.com:8080')).toBe('example.com');
        expect(normalizeHostnameInput('https://user:pw@example.com/')).toBe('example.com');
    });

    it('drops a trailing slash or dot', () => {
        expect(normalizeHostnameInput('example.com/')).toBe('example.com');
        expect(normalizeHostnameInput('example.com.')).toBe('example.com');
    });

    it('returns an empty string for nothing', () => {
        expect(normalizeHostnameInput(undefined)).toBe('');
        expect(normalizeHostnameInput('   ')).toBe('');
        expect(normalizeHostnameInput('https://')).toBe('');
    });
});

describe('isPlausibleHostname', () => {
    it('accepts names with at least one dot', () => {
        expect(isPlausibleHostname('example.com')).toBe(true);
        expect(isPlausibleHostname('www.example.co.uk')).toBe(true);
    });

    it('rejects names without a dot, with spaces or with empty labels', () => {
        expect(isPlausibleHostname('')).toBe(false);
        expect(isPlausibleHostname('localhost')).toBe(false);
        expect(isPlausibleHostname('www.exa mple.com')).toBe(false);
        expect(isPlausibleHostname('www..example.com')).toBe(false);
        expect(isPlausibleHostname('.example.com')).toBe(false);
    });
});
