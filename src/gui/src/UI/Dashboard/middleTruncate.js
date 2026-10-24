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

const ELLIPSIS = '…';
// Longer than any extension in common use (".markdown", ".numbers").
const MAX_EXTENSION_LENGTH = 10;

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** User-perceived characters, so a cut never splits an emoji or a combining mark. */
const graphemes = (text) => segmenter
    ? Array.from(segmenter.segment(text), ({ segment }) => segment)
    : Array.from(text);

/** The largest n in [0, max] for which `fits(n)` holds; `fits` must be monotonic. */
const largestFitting = (max, fits) => {
    let lo = 0;
    let hi = max;
    while ( lo < hi ) {
        const mid = Math.ceil((lo + hi) / 2);
        if ( fits(mid) ) lo = mid;
        else hi = mid - 1;
    }
    return lo;
};

/**
 * Middle-truncates a file name to fit a pixel width, keeping its extension:
 * "quarterly-report-final.pdf" becomes "quarter…final.pdf". The kept start and
 * end each fill about half the room, and cuts fall between graphemes.
 *
 * @param {string} filename
 * @param {number} maxWidth - Room for the name, in pixels
 * @param {(text: string) => number} measure - Pixel width of a string
 * @returns {string} The name itself when it fits
 */
export function middleTruncate (filename, maxWidth, measure) {
    if ( measure(filename) <= maxWidth ) return filename;

    // Only a short, unbroken tail is an extension: in "Report v1.2 final
    // draft" the text after the dot is part of the name.
    const lastDot = filename.lastIndexOf('.');
    const tail = filename.slice(lastDot + 1);
    const hasExtension = lastDot > 0 && tail.length > 0 && tail.length <= MAX_EXTENSION_LENGTH && ! /\s/.test(tail);
    const extension = hasExtension ? filename.slice(lastDot) : '';
    const baseName = hasExtension ? filename.slice(0, lastDot) : filename;

    const available = maxWidth - measure(ELLIPSIS) - measure(extension);
    if ( available <= 0 ) return ELLIPSIS + extension;

    const half = available / 2;
    const parts = graphemes(baseName);
    const startCount = largestFitting(parts.length,
                    n => measure(parts.slice(0, n).join('')) <= half);
    const endCount = largestFitting(parts.length - startCount,
                    n => measure(parts.slice(parts.length - n).join('')) <= half);
    if ( startCount === 0 && endCount === 0 ) return ELLIPSIS + extension;

    return parts.slice(0, startCount).join('')
        + ELLIPSIS
        + parts.slice(parts.length - endCount).join('')
        + extension;
}

export default middleTruncate;
