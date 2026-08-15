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
 * The v1 estimator: average the two cheap approximations (characters over four,
 * words times four thirds) and halve the result. It runs low on purpose — it
 * gates and estimates rather than prices, and the real count arrives from the
 * provider a moment later. The one estimator is shared by the chat credit gate,
 * the chat unreported-stream backstop, and image-prompt pricing, so a future
 * calibration moves all of them at once.
 *
 * @see https://help.openai.com/en/articles/4936856
 */
export const estimateTextTokens = (text: string): number => {
    if (!text) return 0;
    return Math.floor(
        (text.length / 4 + text.split(/\s+/).length * (4 / 3)) / 2,
    );
};
