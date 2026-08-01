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

// Speechify TTS pricing: $10.00 per 1M characters across the Simba model
// family (per Speechify's published API pricing).
// $10.00 per 1M chars = 1000 cents per 1M chars
// In microcents: 1000 * 1_000_000 = 1_000_000_000 microcents per 1M chars
// Per character: 1_000_000_000 / 1_000_000 = 1000 microcents per character
export const SPEECHIFY_TTS_COSTS: Record<string, number> = {
    'simba-3.2': 1000,
    'simba-english': 1000,
    'simba-multilingual': 1000,
};
