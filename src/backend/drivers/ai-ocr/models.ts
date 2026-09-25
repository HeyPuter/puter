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

import type { OcrUsageType } from './costs.js';

export type OcrProviderId = 'aws-textract' | 'mistral';

export interface OcrModel {
    /** Canonical id; for Mistral also the pinned id sent upstream. */
    id: string;
    provider: OcrProviderId;
    /** Other spellings callers may pass, resolved to this entry. */
    aliases?: readonly string[];
    pageUsageType: OcrUsageType;
    annotationUsageType?: OcrUsageType;
}

// Floating vendor aliases (`mistral-ocr-latest`) are pinned to the entry
// they currently point at, so a vendor-side move never changes what a call
// costs before the catalog is synced.
export const OCR_MODELS: readonly OcrModel[] = [
    {
        id: 'aws-textract',
        provider: 'aws-textract',
        aliases: ['textract'],
        pageUsageType: 'aws-textract:detect-document-text:page',
    },
    {
        id: 'mistral-ocr-4-1',
        provider: 'mistral',
        // Mistral retired 2503 but still answers it with the latest model.
        aliases: ['mistral-ocr-latest', 'mistral-ocr-4', 'mistral-ocr-2503'],
        pageUsageType: 'mistral-ocr:mistral-ocr-4-1:page',
        annotationUsageType: 'mistral-ocr:mistral-ocr-4-1:annotations:page',
    },
    {
        id: 'mistral-ocr-4-0',
        provider: 'mistral',
        pageUsageType: 'mistral-ocr:mistral-ocr-4-0:page',
        annotationUsageType: 'mistral-ocr:mistral-ocr-4-0:annotations:page',
    },
    {
        id: 'mistral-ocr-2512',
        provider: 'mistral',
        aliases: ['mistral-ocr-3', 'mistral-ocr-3-0'],
        pageUsageType: 'mistral-ocr:mistral-ocr-2512:page',
        annotationUsageType: 'mistral-ocr:mistral-ocr-2512:annotations:page',
    },
];

/** Models the vendor no longer serves, with the reason callers see. */
export const RETIRED_OCR_MODELS: Readonly<Record<string, string>> = {
    'mistral-ocr-2505':
        'Mistral retired it on 2026-05-31; use mistral-ocr-latest.',
};

export const DEFAULT_OCR_MODEL: Record<OcrProviderId, string> = {
    'aws-textract': 'aws-textract',
    mistral: 'mistral-ocr-4-1',
};

/** Largest input each provider accepts (Textract sync: 10 MB; Mistral: 50 MB). */
export const OCR_MAX_INPUT_BYTES: Record<OcrProviderId, number> = {
    'aws-textract': 10 * 1024 * 1024,
    mistral: 50 * 1024 * 1024,
};

const MODEL_BY_NAME = new Map<string, OcrModel>();
for (const model of OCR_MODELS) {
    MODEL_BY_NAME.set(model.id, model);
    for (const alias of model.aliases ?? []) MODEL_BY_NAME.set(alias, model);
}

export const findOcrModel = (name: string): OcrModel | undefined =>
    MODEL_BY_NAME.get(name.trim().toLowerCase());
