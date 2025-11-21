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

// METADATA // {"ai-commented":{"service":"claude"}}

import BaseService from '../../../services/BaseService.js';
import { OpenAICompletionService } from './OpenAICompletionService.mjs';

export class OpenAICompletionServiceWrapper extends BaseService {
    /** @type {OpenAICompletionService} */
    openAICompletionService;

    _init () {
        this.openAICompletionService = new OpenAICompletionService({
            serviceName: this.service_name,
            config: this.config,
            globalConfig: this.global_config,
            aiChatService: this.services.get('ai-chat'),
            meteringService: this.services.get('meteringService').meteringService,
        });
    }

    async check_moderation (text) {
        return await this.openAICompletionService.checkModeration(text);
    }

    get_default_model () {
        return this.openAICompletionService.get_default_model();
    }

    static IMPLEMENTS = {
        ['puter-chat-completion']: Object.getOwnPropertyNames(OpenAICompletionService.prototype)
            .filter(n => n !== 'constructor')
            .reduce((acc, fn) => ({
                ...acc,
                [fn]: async function (...a) {
                    return await this.openAICompletionService[fn](...a);
                },
            }), {}),
    };
}