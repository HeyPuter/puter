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

import { estimateTextTokens } from '../../shared/tokenEstimate.js';

/** Tokens an image prompt is estimated at before the vendor reports any. */
export const estimateImagePromptTokens = (prompt: string): number => {
    const text = prompt.trim();
    if (text.length === 0) return 0;
    return Math.max(1, estimateTextTokens(text));
};

/** A token count from a vendor's usage report, floored; 0 when unusable. */
export const reportedTokenCount = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : 0;
