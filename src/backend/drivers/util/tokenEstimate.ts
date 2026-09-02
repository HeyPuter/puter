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
 * @see https://help.openai.com/en/articles/4936856
 */
export const estimateTextTokens = (text: string): number => {
    if (!text) return 0;
    return Math.floor(
        (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
    );
};
