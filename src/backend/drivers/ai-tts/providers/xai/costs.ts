/**
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

// xAI TTS pricing (per xAI docs, Voice pricing table): $15.00 per 1M characters
// $15.00 per 1M chars = 1500 cents per 1M chars
// In microcents: 1500 * 1_000_000 = 1_500_000_000 microcents per 1M chars
// Per character: 1_500_000_000 / 1_000_000 = 1500 microcents per character
export const XAI_TTS_COSTS: Record<string, number> = {
    'xai-tts': 1500,
};
