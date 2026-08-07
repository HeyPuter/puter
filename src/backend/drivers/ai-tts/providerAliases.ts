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
 * Canonical `puter-tts` provider ids and the aliases callers may use in their
 * place. Resolution lives here rather than in the SDK so a new alias reaches
 * every caller at once, including clients running an older bundle.
 */

export const TTS_PROVIDERS = [
    'aws-polly',
    'openai',
    'elevenlabs',
    'gemini',
    'xai',
    'speechify',
] as const;

export type TTSProviderName = (typeof TTS_PROVIDERS)[number];

/** The documented default when a caller names no provider. */
export const DEFAULT_TTS_PROVIDER: TTSProviderName = 'aws-polly';

/**
 * Driver names the unified driver answers to. Older SDK bundles put the
 * provider in the driver slot instead of passing `{ provider }`.
 */
export const TTS_DRIVER_ALIASES = [
    'aws-polly',
    'openai-tts',
    'elevenlabs-tts',
    'gemini-tts',
    'xai-tts',
    'speechify-tts',
] as const;

const PROVIDER_BY_ALIAS: Record<string, TTSProviderName> = {
    aws: 'aws-polly',
    'aws-polly': 'aws-polly',
    polly: 'aws-polly',
    openai: 'openai',
    'openai-tts': 'openai',
    '11-labs': 'elevenlabs',
    '11labs': 'elevenlabs',
    eleven: 'elevenlabs',
    'eleven-labs': 'elevenlabs',
    elevenlabs: 'elevenlabs',
    'elevenlabs-tts': 'elevenlabs',
    gemini: 'gemini',
    'gemini-tts': 'gemini',
    google: 'gemini',
    'google-tts': 'gemini',
    grok: 'xai',
    'grok-tts': 'xai',
    'x-ai': 'xai',
    xai: 'xai',
    'xai-tts': 'xai',
    simba: 'speechify',
    speechify: 'speechify',
    'speechify-tts': 'speechify',
};

/** Resolve a caller-supplied provider name, or `undefined` if unrecognized. */
export function normalizeTTSProvider(
    value: unknown,
): TTSProviderName | undefined {
    if (typeof value !== 'string') return undefined;
    return PROVIDER_BY_ALIAS[value.trim().toLowerCase()];
}
