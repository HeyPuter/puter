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

// Puter's language codes that aren't the BCP 47 tag for that language: Intl
// reads `br` as Breton, and `ua` and `emoji` as nothing at all.
const INTL_LOCALES = { br: 'pt-BR', ua: 'uk', zh: 'zh-CN', zhtw: 'zh-TW', emoji: 'en' };

/**
 * The tag to hand Intl (dates, numbers) for one of Puter's language codes.
 *
 * @param {string} locale - A Puter language code, e.g. `window.locale`
 * @returns {string}
 */
export const intlLocale = (locale) => INTL_LOCALES[locale] ?? locale;
