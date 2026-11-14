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

/** The `output_format` text to speech and speech to speech fall back to. */
export const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128';

// https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// mp3_44100_192 needs the Creator tier; pcm/wav at 44.1 kHz need Pro.
export const OUTPUT_FORMATS = new Set([
    'alaw_8000',
    'mp3_22050_32',
    'mp3_24000_48',
    'mp3_44100_32',
    'mp3_44100_64',
    'mp3_44100_96',
    'mp3_44100_128',
    'mp3_44100_192',
    'opus_48000_32',
    'opus_48000_64',
    'opus_48000_96',
    'opus_48000_128',
    'opus_48000_192',
    'pcm_8000',
    'pcm_16000',
    'pcm_22050',
    'pcm_24000',
    'pcm_32000',
    'pcm_44100',
    'pcm_48000',
    'ulaw_8000',
    'wav_8000',
    'wav_16000',
    'wav_22050',
    'wav_24000',
    'wav_32000',
    'wav_44100',
    'wav_48000',
]);
