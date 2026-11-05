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

import { intlLocale } from './intlLocale.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago `at` was, in the reader's language: "now", "5 minutes ago",
 * "yesterday", then a short date once it's more than a week old. Uses the
 * platform's formatters so nothing here needs translating; falls back to a
 * plain date where they're missing.
 *
 * @param {number} at - Epoch ms
 * @param {number} now - Epoch ms
 * @param {string} [locale]
 * @returns {string}
 */
export const formatRelativeTime = (at, now, locale = 'en') => {
    const diff = Math.max(0, now - at);
    const rtf = relativeFormatter(locale);
    if ( diff < 45_000 ) return rtf ? rtf.format(0, 'second') : 'now';
    if ( diff < 45 * MINUTE ) {
        const minutes = Math.max(1, Math.round(diff / MINUTE));
        return rtf ? rtf.format(-minutes, 'minute') : `${minutes}m`;
    }
    const then = new Date(at);
    // "Yesterday" names a calendar day, so days are counted midnight to midnight.
    const days = Math.round((startOfDay(new Date(now)) - startOfDay(then)) / DAY);
    if ( days === 0 || diff < 22 * HOUR ) {
        const hours = Math.max(1, Math.round(diff / HOUR));
        return rtf ? rtf.format(-hours, 'hour') : `${hours}h`;
    }
    if ( days < 7 ) {
        return rtf ? rtf.format(-days, 'day') : `${days}d`;
    }
    const sameYear = then.getFullYear() === new Date(now).getFullYear();
    const dtf = dateFormatter(locale, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
    });
    return dtf ? dtf.format(then) : then.toLocaleDateString();
};

/**
 * The full moment, for a tooltip behind the relative form.
 *
 * @param {number} at - Epoch ms
 * @param {string} [locale]
 * @returns {string}
 */
export const formatAbsoluteTime = (at, locale = 'en') => {
    const dtf = dateFormatter(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return dtf ? dtf.format(new Date(at)) : new Date(at).toLocaleString();
};

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const tryMake = (make) => {
    try {
        return make();
    } catch {
        return null;
    }
};

// A listing formats a date per row; making a formatter costs far more than
// using one. Keyed by language and options, of which there are a handful.
const formatters = new Map();
const cached = (key, make) => {
    if ( ! formatters.has(key) ) formatters.set(key, make());
    return formatters.get(key);
};

// An unknown locale tag throws; the English formatter beats none at all.
const relativeFormatter = (locale) => {
    if ( typeof Intl === 'undefined' || ! Intl.RelativeTimeFormat ) return null;
    return cached(`relative:${locale}`, () => tryMake(() => new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: 'auto' }))
        ?? tryMake(() => new Intl.RelativeTimeFormat('en', { numeric: 'auto' })));
};

const dateFormatter = (locale, options) => {
    if ( typeof Intl === 'undefined' || ! Intl.DateTimeFormat ) return null;
    return cached(`date:${locale}:${JSON.stringify(options)}`, () => tryMake(() => new Intl.DateTimeFormat(intlLocale(locale), options))
        ?? tryMake(() => new Intl.DateTimeFormat('en', options)));
};
