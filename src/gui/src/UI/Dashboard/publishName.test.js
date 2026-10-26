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
import { finalizePublishName, normalizePublishName, PUBLISH_NAME_RULES } from './publishName.js';

const { website, worker } = PUBLISH_NAME_RULES;

describe('normalizePublishName', () => {
    it('lowercases and turns whitespace runs into one hyphen', () => {
        expect(normalizePublishName('My  Cool Site', website)).toBe('my-cool-site');
    });

    it('drops characters a website name cannot hold', () => {
        expect(normalizePublishName('café site!.v2', website)).toBe('caf-sitev2');
    });

    it('turns underscores into hyphens in a website name', () => {
        expect(normalizePublishName('My_Cool _Site', website)).toBe('my-cool-site');
    });

    it('keeps underscores in a worker name', () => {
        expect(normalizePublishName('My_API', worker)).toBe('my_api');
    });

    it('keeps hyphens at the ends while the user is still typing', () => {
        expect(normalizePublishName('my-', website)).toBe('my-');
    });
});

describe('finalizePublishName', () => {
    it('trims hyphens from both ends', () => {
        expect(finalizePublishName(' -my site- ', website)).toBe('my-site');
    });

    it('is empty when nothing usable is left', () => {
        expect(finalizePublishName('!!! ', website)).toBe('');
    });

    it('caps the length', () => {
        expect(finalizePublishName('a'.repeat(80), website)).toHaveLength(64);
        expect(finalizePublishName('a'.repeat(80), worker)).toHaveLength(63);
    });
});
