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
import translations from './translations/translations.js';
import { intlLocale } from './intlLocale.js';

describe('intlLocale', () => {
    it('maps the codes Intl would misread', () => {
        expect(intlLocale('br')).toBe('pt-BR');
        expect(intlLocale('ua')).toBe('uk');
        expect(intlLocale('zhtw')).toBe('zh-TW');
        expect(intlLocale('emoji')).toBe('en');
        expect(intlLocale('de')).toBe('de');
    });

    it('gives Intl a tag it accepts for every language Puter ships', () => {
        for ( const code of Object.keys(translations) ) {
            expect(() => new Intl.DateTimeFormat(intlLocale(code)), code).not.toThrow();
        }
    });
});
