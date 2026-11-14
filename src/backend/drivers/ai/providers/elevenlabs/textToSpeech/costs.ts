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

// Microcents per character for TTS synthesis, per model. Values mirror the
// ElevenLabs scale tier (per-additional-char × 0.9), scaled by each model's
// `character_cost_multiplier` from GET /v1/models. Seconds-based costs for
// speech-to-speech live on VoiceChangerDriver.
export const ELEVENLABS_TTS_COSTS: Record<string, number> = {
    eleven_v4: 18000 * 0.9,
    eleven_v4_turbo: 9000 * 0.9,
    eleven_v3: 18000 * 0.9,
    eleven_v3_conversational: 9000 * 0.9,
    eleven_multilingual_v2: 18000 * 0.9,
    eleven_flash_v2_5: 9000 * 0.9,
    eleven_flash_v2: 9000 * 0.9,
};
