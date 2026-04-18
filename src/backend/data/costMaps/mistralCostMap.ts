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

export const MISTRAL_COST_MAP = {
    // Mistral models (values in microcents/token, from MistralAIService.js)
    'mistral:mistral-large-latest:prompt_tokens': 200,
    'mistral:mistral-large-latest:completion_tokens': 600,
    'mistral:pixtral-large-latest:prompt_tokens': 200,
    'mistral:pixtral-large-latest:completion_tokens': 600,
    'mistral:mistral-small-latest:prompt_tokens': 20,
    'mistral:mistral-small-latest:completion_tokens': 60,
    'mistral:codestral-latest:prompt_tokens': 30,
    'mistral:codestral-latest:completion_tokens': 90,
    'mistral:ministral-8b-latest:prompt_tokens': 10,
    'mistral:ministral-8b-latest:completion_tokens': 10,
    'mistral:ministral-3b-latest:prompt_tokens': 4,
    'mistral:ministral-3b-latest:completion_tokens': 4,
    'mistral:pixtral-12b:prompt_tokens': 15,
    'mistral:pixtral-12b:completion_tokens': 15,
    'mistral:mistral-nemo:prompt_tokens': 15,
    'mistral:mistral-nemo:completion_tokens': 15,
    'mistral:open-mistral-7b:prompt_tokens': 25,
    'mistral:open-mistral-7b:completion_tokens': 25,
    'mistral:open-mixtral-8x7b:prompt_tokens': 7,
    'mistral:open-mixtral-8x7b:completion_tokens': 7,
    'mistral:open-mixtral-8x22b:prompt_tokens': 2,
    'mistral:open-mixtral-8x22b:completion_tokens': 6,
    'mistral:magistral-medium-latest:prompt_tokens': 200,
    'mistral:magistral-medium-latest:completion_tokens': 500,
    'mistral:magistral-small-latest:prompt_tokens': 10,
    'mistral:magistral-small-latest:completion_tokens': 10,
    'mistral:mistral-medium-latest:prompt_tokens': 40,
    'mistral:mistral-medium-latest:completion_tokens': 200,
    'mistral:mistral-moderation-latest:prompt_tokens': 10,
    'mistral:mistral-moderation-latest:completion_tokens': 10,
    'mistral:devstral-small-latest:prompt_tokens': 10,
    'mistral:devstral-small-latest:completion_tokens': 10,
    'mistral:mistral-saba-latest:prompt_tokens': 20,
    'mistral:mistral-saba-latest:completion_tokens': 60,
    'mistral:open-mistral-nemo:prompt_tokens': 10,
    'mistral:open-mistral-nemo:completion_tokens': 10,
    'mistral:mistral-ocr-latest:prompt_tokens': 100,
    'mistral:mistral-ocr-latest:completion_tokens': 300,
    // OCR page-based pricing (values in microcents/page)
    // $1 / 1000 pages -> $0.001 per page -> 100000 microcents
    'mistral-ocr:ocr:page': 100000,
    // $3 / 1000 pages -> $0.003 per page -> 300000 microcents
    'mistral-ocr:annotations:page': 300000,
};
