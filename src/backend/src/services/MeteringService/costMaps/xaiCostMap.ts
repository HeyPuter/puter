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

export const XAI_COST_MAP = {
    // Grok Beta
    'xai:grok-beta:prompt_tokens': 500,
    'xai:grok-beta:completion-tokens': 1500,

    // Grok Vision Beta
    'xai:grok-vision-beta:prompt_tokens': 500,
    'xai:grok-vision-beta:completion-tokens': 1500,
    'xai:grok-vision-beta:image': 1000,

    // Grok 3
    'xai:grok-3:prompt_tokens': 300,
    'xai:grok-3:completion-tokens': 1500,

    // Grok 3 Fast
    'xai:grok-3-fast:prompt_tokens': 500,
    'xai:grok-3-fast:completion-tokens': 2500,

    // Grok 3 Mini
    'xai:grok-3-mini:prompt_tokens': 30,
    'xai:grok-3-mini:completion-tokens': 50,

    // Grok 3 Mini Fast
    'xai:grok-3-mini-fast:prompt_tokens': 60,
    'xai:grok-3-mini-fast:completion-tokens': 400,

    // Grok 2 Vision
    'xai:grok-2-vision:prompt_tokens': 200,
    'xai:grok-2-vision:completion-tokens': 1000,

    // Grok 2
    'xai:grok-2:prompt_tokens': 200,
    'xai:grok-2:completion-tokens': 1000,
};