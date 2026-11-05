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

import { OpenAI } from 'openai';
import type { MeteringService } from '../../../../services/metering/MeteringService.js';
import type { IChatModel } from '../../types.js';
import { cachedRemoteCatalog } from '../../utils/cachedRemoteCatalog.js';
import { fetchAlibabaCatalog } from './catalog.js';
import { sdkClientOptions } from '../../utils/sdkClient.js';
import {
    type ChatProviderConfig,
    OpenAICompatProvider,
} from '../OpenAICompatProvider.js';
import { ALIBABA_MODELS } from './models.js';

export class AlibabaProvider extends OpenAICompatProvider {
    #apiBaseUrl: string;
    #apiKey: string;
    constructor(config: ChatProviderConfig, meteringService: MeteringService) {
        super(meteringService, {
            client: new OpenAI({
                apiKey: config.apiKey,
                baseURL:
                    config.apiBaseUrl ??
                    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
                ...sdkClientOptions(),
            }),
            requireTokenPrices: true,
            defaultModel: 'qwen-plus-latest',
            meteringPrefix: 'alibaba',
            defaultMaxTokens: 1000,
            passthrough: ['temperature'],
        });
        this.#apiBaseUrl = (
            config.apiBaseUrl ??
            'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
        )
            .replace(/\/(?:compatible-mode\/)?v1\/?$/, '')
            .replace(/\/$/, '');
        this.#apiKey = config.apiKey;
    }

    override async models(): Promise<IChatModel[]> {
        return this.#catalog();
    }

    #catalog = cachedRemoteCatalog({
        name: 'Alibaba catalog',
        fallback: ALIBABA_MODELS,
        fetch: (signal, previous) =>
            fetchAlibabaCatalog(
                this.#apiBaseUrl,
                this.#apiKey,
                signal,
                previous,
            ),
    });
}
