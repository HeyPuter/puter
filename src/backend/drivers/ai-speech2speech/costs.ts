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

// Microcents per second of audio, per ElevenLabs speech-to-speech model.
// Values mirror the ElevenLabs scale tier (per-unit × 0.9).
export const VOICE_CHANGER_COSTS: Record<string, number> = {
    'elevenlabs:eleven_multilingual_sts_v2:second': 300000 * 0.9,
    'elevenlabs:eleven_english_sts_v2:second': 300000 * 0.9,
};
