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
 */

// @vitest-environment jsdom

import { describe, it, expect, afterEach } from 'vitest';
import { isEntryVisible, isHiddenName, showHiddenFiles } from './hiddenFiles.js';

describe('isHiddenName', () => {
    it('is true only for dot-prefixed names', () => {
        expect(isHiddenName('.bashrc')).toBe(true);
        expect(isHiddenName('Documents')).toBe(false);
        expect(isHiddenName('a.b.c')).toBe(false);
        expect(isHiddenName(undefined)).toBe(false);
    });
});

describe('isEntryVisible', () => {
    it('always lists names that are not dot-prefixed', () => {
        expect(isEntryVisible('Documents', false)).toBe(true);
        expect(isEntryVisible('report.txt', false)).toBe(true);
        expect(isEntryVisible('a.b.c', false)).toBe(true);
    });

    it('hides dot-prefixed names unless the preference is on', () => {
        expect(isEntryVisible('.bashrc', false)).toBe(false);
        expect(isEntryVisible('.bashrc', true)).toBe(true);
        expect(isEntryVisible('.config', false)).toBe(false);
        expect(isEntryVisible('.config', true)).toBe(true);
    });

    it('tolerates a missing name', () => {
        expect(isEntryVisible(undefined, false)).toBe(true);
        expect(isEntryVisible(null, false)).toBe(true);
    });
});

describe('showHiddenFiles', () => {
    afterEach(() => {
        delete window.user_preferences;
    });

    it('is off when preferences are unset', () => {
        expect(showHiddenFiles()).toBe(false);
        window.user_preferences = {};
        expect(showHiddenFiles()).toBe(false);
    });

    it('follows the preference', () => {
        window.user_preferences = { show_hidden_files: true };
        expect(showHiddenFiles()).toBe(true);
        window.user_preferences = { show_hidden_files: false };
        expect(showHiddenFiles()).toBe(false);
    });
});
