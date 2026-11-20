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

import en from './translations/en.js';
import { installI18n } from './i18nCore.js';

installI18n({ en });

/**
 * Loads only the preferred language, so embeds don't ship every translation.
 * Unknown or unavailable languages keep English.
 * @param {string} locale
 */
export async function loadLocale (locale) {
    if ( typeof locale !== 'string' || locale === 'en' || ! /^[a-z]+$/.test(locale) ) return;
    try {
        const { default: language } = await import(
            /* webpackExclude: /translations\.js$/ */ `./translations/${locale}.js`
        );
        installI18n({ en, [locale]: language });
    } catch {
        // English is already installed.
    }
}
