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

import type { ProviderCatalog } from '../util/providerRegistry.js';

/**
 * Canonical `puter-speech2txt` provider ids and the aliases callers may use in
 * their place. Resolution lives here rather than in the SDK so a new alias
 * reaches every caller at once, including clients on an older bundle.
 */

export const SPEECH_TO_TEXT_PROVIDERS = ['openai', 'xai'] as const;

export type SpeechToTextProviderName =
    (typeof SPEECH_TO_TEXT_PROVIDERS)[number];

/** The documented default when a caller names no provider. */
export const DEFAULT_SPEECH_TO_TEXT_PROVIDER: SpeechToTextProviderName =
    'openai';

/**
 * Driver names the unified driver answers to. Older SDK bundles put the
 * provider in the driver slot instead of passing `{ provider }`.
 */
export const SPEECH_TO_TEXT_DRIVER_ALIASES = [
    'openai-speech2txt',
    'xai-speech2txt',
] as const;

const PROVIDER_BY_ALIAS: Record<string, SpeechToTextProviderName> = {
    openai: 'openai',
    'openai-speech2txt': 'openai',
    whisper: 'openai',
    grok: 'xai',
    'x-ai': 'xai',
    xai: 'xai',
    'xai-speech2txt': 'xai',
};

export const SPEECH_TO_TEXT_CATALOG: ProviderCatalog = {
    label: 'Speech-to-text',
    ids: SPEECH_TO_TEXT_PROVIDERS,
    defaultId: DEFAULT_SPEECH_TO_TEXT_PROVIDER,
    aliases: PROVIDER_BY_ALIAS,
};
