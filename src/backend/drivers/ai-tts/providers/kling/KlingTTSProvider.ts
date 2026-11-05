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
import {
    type AiMeteringService,
    withStreamedAiCharge,
} from '../../../util/aiCostFactor.js';
import { klingRequest } from '../../../util/kling.js';
import { SAMPLE_AUDIO_URL } from '../../../util/testMode.js';
import {
    upstreamBodyStream,
    upstreamFetch,
} from '../../../util/upstreamErrors.js';
import type {
    ISynthesizeArgs,
    ITTSEngine,
    ITTSProvider,
    ITTSVoice,
} from '../../types.js';
import { assertMaxChars, TTS_UPSTREAM_TIMEOUT_MS } from '../common.js';

const MODEL = 'kling-tts';
const DEFAULT_VOICE = 'oversea_male1';
const MAX_TEXT_CHARS = 1000;

/** $0.007 per request, https://kling.ai/document-api/pricing/base/video. */
export const KLING_TTS_UCENTS_PER_REQUEST = 700_000;

const LANGUAGE_NAMES: Record<string, string> = {
    en: 'English',
    zh: 'Chinese',
};

// Voice ids Kling accepted on 2026-10-20, with the languages each answered
// to; Kling's voice guide is not published as data. Requesting a voice in a
// language it lacks fails upstream with "Voice id not found".
const VOICES: Record<string, readonly string[]> = {
    genshin_vindi2: ['en', 'zh'],
    zhinen_xuesheng: ['en', 'zh'],
    AOT: ['en'],
    ai_shatang: ['en', 'zh'],
    genshin_klee2: ['en', 'zh'],
    genshin_kirara: ['en', 'zh'],
    ai_kaiya: ['en', 'zh'],
    oversea_male1: ['en'],
    ai_chenjiahao_712: ['en', 'zh'],
    girlfriend_4_speech02: ['en'],
    'chat1_female_new-3': ['en', 'zh'],
    'chat_0407_5-1': ['en'],
    'cartoon-boy-07': ['en', 'zh'],
    uk_boy1: ['en'],
    'cartoon-girl-01': ['en', 'zh'],
    PeppaPig_platform: ['en'],
    ai_huangzhong_712: ['en'],
    ai_huangyaoshi_712: ['en', 'zh'],
    ai_laoguowang_712: ['en', 'zh'],
    chengshu_jiejie: ['en', 'zh'],
    you_pingjing: ['en', 'zh'],
    calm_story1: ['en'],
    uk_man2: ['en'],
    laopopo_speech02: ['en', 'zh'],
    heainainai_speech02: ['en', 'zh'],
    tiyuxi_xuedi: ['zh'],
    tiexin_nanyou: ['zh'],
    girlfriend_1_speech02: ['zh'],
    girlfriend_2_speech02: ['zh'],
    zhuxi_speech02: ['zh'],
    uk_oldman3: ['zh'],
    dongbeilaotie_speech02: ['zh'],
    chongqingxiaohuo_speech02: ['zh'],
    chuanmeizi_speech02: ['zh'],
    chaoshandashu_speech02: ['zh'],
    ai_taiwan_man2_speech02: ['zh'],
    xianzhanggui_speech02: ['zh'],
    tianjinjiejie_speech02: ['zh'],
    'diyinnansang_DB_CN_M_04-v2': ['zh'],
    'yizhipiannan-v1': ['zh'],
    'guanxiaofang-v2': ['zh'],
    'tianmeixuemei-v1': ['zh'],
    'daopianyansang-v1': ['zh'],
    'mengwa-v1': ['zh'],
};

interface KlingTTSTask {
    task_status?: string;
    task_status_msg?: string;
    task_result?: { audios?: Array<{ url?: string }> };
}

const fieldInvalid = (key: string, message: string) =>
    new HttpError(400, message, {
        legacyCode: 'field_invalid',
        fields: { key },
    });

/**
 * Kling AI text-to-speech. `/v1/audio/tts` answers synchronously with a hosted
 * MP3, which is streamed back to the caller. Billed per request.
 * https://kling.ai/document-api/api/video/avatar/text-to-speech
 */
export class KlingTTSProvider implements ITTSProvider {
    readonly providerName = 'kling';

    #apiKey: string;
    #apiBaseUrl: string | undefined;

    constructor(
        private readonly meteringService: AiMeteringService,
        config: { apiKey: string; apiBaseUrl?: string },
    ) {
        if (!config.apiKey) {
            throw new Error('Kling TTS requires an API key');
        }
        this.#apiKey = config.apiKey;
        this.#apiBaseUrl = config.apiBaseUrl;
    }

    async listVoices(): Promise<ITTSVoice[]> {
        return Object.entries(VOICES).map(([id, languages]) => ({
            id,
            name: id,
            language: {
                name: LANGUAGE_NAMES[languages[0]],
                code: languages[0],
            },
            labels: { languages: languages.join(',') },
            provider: 'kling',
            supported_models: [MODEL],
        }));
    }

    async listEngines(): Promise<ITTSEngine[]> {
        return [{ id: MODEL, name: 'Kling TTS', provider: 'kling' }];
    }

    getReportedCosts(): Record<string, unknown>[] {
        return [
            {
                usageType: `kling:${MODEL}:request`,
                ucentsPerUnit: KLING_TTS_UCENTS_PER_REQUEST,
                unit: 'request',
                source: 'driver:aiTts/kling',
            },
        ];
    }

    async synthesize(
        args: ISynthesizeArgs,
    ): Promise<DriverStreamResult | { url: string; content_type: string }> {
        const { text, voice, model, language, test_mode } = args;
        const speed = (args.voice_settings ?? args.voiceSettings)?.speed;

        if (test_mode) {
            return { url: SAMPLE_AUDIO_URL, content_type: 'audio' };
        }
        if (typeof text !== 'string' || !text.trim()) {
            throw new HttpError(400, 'Missing required field: text', {
                legacyCode: 'field_required',
                fields: { key: 'text' },
            });
        }
        assertMaxChars('text', text, MAX_TEXT_CHARS);
        if (model !== undefined && model !== MODEL) {
            throw fieldInvalid(
                'model',
                `Invalid model: ${model}. Expected: ${MODEL}`,
            );
        }

        const voiceId = voice || DEFAULT_VOICE;
        const languages = VOICES[voiceId];
        if (!languages) {
            throw fieldInvalid('voice', `Invalid Kling voice: ${voiceId}`);
        }
        // `en-US` and `zh-CN` name the same languages as `en` and `zh`.
        const wanted =
            typeof language === 'string'
                ? language.trim().slice(0, 2).toLowerCase()
                : undefined;
        if (wanted && !languages.includes(wanted)) {
            throw fieldInvalid(
                'language',
                `Kling voice ${voiceId} speaks ${languages.join(' or ')}, not ${language}`,
            );
        }
        if (
            speed !== undefined &&
            (typeof speed !== 'number' || speed < 0.8 || speed > 2)
        ) {
            throw fieldInvalid(
                'voice_settings.speed',
                'voice_settings.speed must be a number from 0.8 to 2.0',
            );
        }

        const actor = Context.get('actor')!;
        const usageType = `kling:${MODEL}:request`;
        return withStreamedAiCharge(
            this.meteringService,
            actor,
            usageType,
            KLING_TTS_UCENTS_PER_REQUEST,
            async () => {
                const task = await klingRequest<KlingTTSTask>(
                    this.#apiKey,
                    'POST',
                    '/v1/audio/tts',
                    {
                        baseUrl: this.#apiBaseUrl,
                        timeoutMs: TTS_UPSTREAM_TIMEOUT_MS,
                        body: {
                            text,
                            voice_id: voiceId,
                            voice_language: wanted ?? languages[0],
                            ...(speed !== undefined
                                ? { voice_speed: speed }
                                : {}),
                        },
                    },
                );
                const url = task.task_result?.audios?.[0]?.url;
                if (task.task_status !== 'succeed' || !url) {
                    throw new HttpError(
                        502,
                        task.task_status_msg || 'Kling TTS returned no audio',
                        {
                            legacyCode: 'upstream_failed',
                            fields: { provider: 'kling' },
                        },
                    );
                }
                const response = await upstreamFetch(
                    'kling',
                    url,
                    { method: 'GET' },
                    {
                        providerLabel: 'Kling TTS',
                        timeoutMs: TTS_UPSTREAM_TIMEOUT_MS,
                        stream: true,
                    },
                );
                return {
                    dataType: 'stream',
                    content_type: 'audio/mpeg',
                    chunked: true,
                    stream: upstreamBodyStream(response),
                };
            },
            () =>
                this.meteringService.incrementUsage(
                    actor,
                    usageType,
                    1,
                    KLING_TTS_UCENTS_PER_REQUEST,
                ),
        );
    }
}
