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
    "mistral:mistral-large-latest:input": 200,
    "mistral:mistral-large-latest:output": 600,
    "mistral:pixtral-large-latest:input": 200,
    "mistral:pixtral-large-latest:output": 600,
    "mistral:mistral-small-latest:input": 20,
    "mistral:mistral-small-latest:output": 60,
    "mistral:codestral-latest:input": 30,
    "mistral:codestral-latest:output": 90,
    "mistral:ministral-8b-latest:input": 10,
    "mistral:ministral-8b-latest:output": 10,
    "mistral:ministral-3b-latest:input": 4,
    "mistral:ministral-3b-latest:output": 4,
    "mistral:pixtral-12b:input": 15,
    "mistral:pixtral-12b:output": 15,
    "mistral:mistral-nemo:input": 15,
    "mistral:mistral-nemo:output": 15,
    "mistral:open-mistral-7b:input": 25,
    "mistral:open-mistral-7b:output": 25,
    "mistral:open-mixtral-8x7b:input": 7,
    "mistral:open-mixtral-8x7b:output": 7,
    "mistral:open-mixtral-8x22b:input": 2,
    "mistral:open-mixtral-8x22b:output": 6,
    "mistral:magistral-medium-latest:input": 200,
    "mistral:magistral-medium-latest:output": 500,
    "mistral:magistral-small-latest:input": 10,
    "mistral:magistral-small-latest:output": 10,
    "mistral:mistral-medium-latest:input": 40,
    "mistral:mistral-medium-latest:output": 200,
    "mistral:mistral-moderation-latest:input": 10,
    "mistral:mistral-moderation-latest:output": 10,
    "mistral:devstral-small-latest:input": 10,
    "mistral:devstral-small-latest:output": 10,
    "mistral:mistral-saba-latest:input": 20,
    "mistral:mistral-saba-latest:output": 60,
    "mistral:open-mistral-nemo:input": 10,
    "mistral:open-mistral-nemo:output": 10,
    "mistral:mistral-ocr-latest:input": 100,
    "mistral:mistral-ocr-latest:output": 300,
};