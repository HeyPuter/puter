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

import { Context } from '../../../../core/context.js';
import { HttpError } from '../../../../core/http/HttpError.js';
import type { DriverStreamResult } from '../../../meta.js';
import { ElevenLabsSpeechToSpeechProvider } from '../../providers/elevenlabs/speechToSpeech/ElevenLabsSpeechToSpeechProvider.js';
import { VOICE_CHANGER_COSTS } from '../../providers/elevenlabs/speechToSpeech/costs.js';
import { PuterDriver } from '../../../types.js';
import {
    type AiMeteringService,
    withAiCostFactor,
} from '../../../../util/aiCostFactor.js';
import { AI_CONCURRENT, AI_RATE_LIMIT } from '../../shared/aiLimits.js';
import {
    type ProviderCatalog,
    ProviderRegistry,
} from '../../shared/providerRegistry.js';
import { readProviderKey } from '../../../../util/aiProviderKey.js';
import { SAMPLE_AUDIO_URL } from '../../shared/testMode.js';
import type { ConvertArgs } from './types.js';

/**
 * Driver implementing `puter-speech2speech` — voice changer. Currently a single
 * provider (ElevenLabs).
 */

const VOICE_CHANGER_CATALOG: ProviderCatalog = {
    label: 'Speech-to-speech',
    ids: ['elevenlabs'],
    defaultId: 'elevenlabs',
    aliases: { elevenlabs: 'elevenlabs' },
};

export class VoiceChangerDriver extends PuterDriver {
    readonly driverInterface = 'puter-speech2speech';
    readonly driverName = 'ai-speech2speech';
    // Older SDK bundles name the provider in the driver slot.
    readonly driverAliases = ['elevenlabs-voice-changer'];
    readonly isDefault = true;

    // Shared AI policy — see `drivers/ai/shared/aiLimits.ts` for the tier table.
    readonly rateLimit = AI_RATE_LIMIT;
    readonly concurrent = AI_CONCURRENT;

    /** Metering scoped to this driver. */
    get #aiMetering(): AiMeteringService {
        return withAiCostFactor(
            this.services.metering,
            this.clients.event,
            this.driverName,
        );
    }

    override getReportedCosts(): Record<string, unknown>[] {
        return Object.entries(VOICE_CHANGER_COSTS).map(
            ([usageType, ucentsPerUnit]) => ({
                usageType,
                ucentsPerUnit,
                unit: 'second',
                source: 'driver:aiSpeech2Speech',
            }),
        );
    }

    #providers = new ProviderRegistry<ElevenLabsSpeechToSpeechProvider>(
        VOICE_CHANGER_CATALOG,
    );

    override onServerStart() {
        const elevenlabs = this.config.providers?.elevenlabs;
        const apiKey = readProviderKey(elevenlabs);
        if (!apiKey) return;
        this.#providers.register(
            'elevenlabs',
            new ElevenLabsSpeechToSpeechProvider(
                {
                    stores: this.stores,
                    fs: this.services.fs,
                    metering: this.#aiMetering,
                },
                {
                    apiKey,
                    apiBaseUrl: elevenlabs?.apiBaseUrl as string | undefined,
                    defaultVoiceId: elevenlabs?.defaultVoiceId as
                        string | undefined,
                    defaultModelId: elevenlabs?.speechToSpeechModelId as
                        string | undefined,
                },
            ),
        );
    }

    async convert(
        args: ConvertArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        // Only one provider exists today, but naming a different one should
        // fail loudly rather than quietly convert with this one.
        const providerName = this.#providers.resolve(args.provider);

        if (args.test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio/mpeg' };
        }

        const elevenlabs = this.#providers.get(providerName);
        if (!elevenlabs) {
            throw new HttpError(500, 'ElevenLabs API key not configured', {
                legacyCode: 'internal_error',
            });
        }

        const actor = Context.get('actor');
        if (!actor)
            throw new HttpError(401, 'Authentication required', {
                legacyCode: 'unauthorized',
            });

        return elevenlabs.convert(args, actor);
    }
}
