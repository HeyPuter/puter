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

const COLOR_SCHEME_FEATURE = /\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)/gi;

/**
 * The theme an embedding page forces, from its `#theme=dark|light` fragment.
 * Null when it names none, so the embed follows the OS.
 *
 * @param {string} hash - `location.hash`
 * @returns {'dark' | 'light' | null}
 */
export const embedHostTheme = (hash) => {
    const value = new URLSearchParams(String(hash ?? '').replace(/^#/, '')).get('theme');
    return value === 'dark' || value === 'light' ? value : null;
};

/**
 * Makes the document's `prefers-color-scheme` rules match `theme` whatever
 * the OS prefers. Chromium doesn't pass a frame's `color-scheme` on to the
 * document inside it, so the host's forced theme has to be applied here.
 *
 * @param {Document} doc - with its stylesheets loaded
 * @param {'dark' | 'light'} theme
 */
export const forceColorScheme = (doc, theme) => {
    doc.documentElement.style.colorScheme = theme;
    const force = (rules) => {
        for ( const rule of rules ) {
            const media = rule.media?.mediaText;
            // Always true for the forced scheme, never for the other.
            const forced = media?.replace(COLOR_SCHEME_FEATURE, (_, scheme) => (
                scheme.toLowerCase() === theme ? '(min-width: 0px)' : '(max-width: -1px)'
            ));
            if ( forced !== media ) rule.media.mediaText = forced;
            if ( rule.cssRules ) force(rule.cssRules);
        }
    };
    for ( const sheet of doc.styleSheets ) {
        let rules;
        try {
            rules = sheet.cssRules;
        } catch { continue; /* Another origin's stylesheet can't be read. */ }
        force(rules);
    }
};
