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

/** The code units `\s` matches. */
const isSpace = (c: number): boolean =>
    c === 0x20 ||
    (c >= 0x09 && c <= 0x0d) ||
    (c >= 0xa0 &&
        (c === 0xa0 ||
            c === 0x1680 ||
            (c >= 0x2000 && c <= 0x200a) ||
            c === 0x2028 ||
            c === 0x2029 ||
            c === 0x202f ||
            c === 0x205f ||
            c === 0x3000 ||
            c === 0xfeff));

/** Whitespace runs in `text.slice(0, end)`, one less than `split(/\s+/)` gives. */
const countSpaceRuns = (text: string, end: number): number => {
    let runs = 0;
    let inSpace = false;
    for (let i = 0; i < end; i++) {
        const space = isSpace(text.charCodeAt(i));
        if (space && !inSpace) runs++;
        inSpace = space;
    }
    return runs;
};

/** How much text is left to scan for word boundaries, and what was seen. */
export interface WordScanBudget {
    chars: number;
    scannedChars: number;
    scannedRuns: number;
}

/** About 5 ms of scanning. */
const WORD_SCAN_CHARS = 1024 * 1024;

export const createWordScanBudget = (): WordScanBudget => ({
    chars: WORD_SCAN_CHARS,
    scannedChars: 0,
    scannedRuns: 0,
});

/**
 * Tokens a run of text is worth.
 *
 * The v1 estimator: the mean of two cheap approximations — characters over
 * four, words times four thirds. On prose the two agree and the mean lands
 * within a few percent of the real count; on text with few whitespace
 * boundaries the word term collapses and the mean runs about half low on JSON
 * and code, and a fraction of the real count on base64, logs, or CJK prose.
 * Shared by the chat credit gate, the chat unreported-stream backstop, and
 * image-prompt pricing, so a calibration moves all of them at once.
 *
 * Words are counted over at most `budget.chars` characters, which this call
 * spends; text past that is given the word density scanned so far. Pass one
 * budget across a request's parts to bound the scan per request.
 *
 * @see https://help.openai.com/en/articles/4936856
 */
export const estimateTextTokens = (
    text: string,
    budget: WordScanBudget = createWordScanBudget(),
): number => {
    if (!text) return 0;
    const scanned = Math.min(text.length, budget.chars);
    const runs = countSpaceRuns(text, scanned);
    budget.chars -= scanned;
    budget.scannedChars += scanned;
    budget.scannedRuns += runs;
    const unscannedRuns =
        budget.scannedChars > 0
            ? ((text.length - scanned) * budget.scannedRuns) /
              budget.scannedChars
            : 0;
    const words = 1 + runs + unscannedRuns;
    return Math.floor((text.length / 4 + words * (4 / 3)) / 2);
};
