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

// Microcents per page. Textract DetectDocumentText $1.50/1000 pages. Mistral
// OCR 4.x $4/1000 pages with annotations $5/1000; OCR 3 $2 and $3.
export const OCR_COSTS = {
    'aws-textract:detect-document-text:page': 150000,
    'mistral-ocr:mistral-ocr-4-1:page': 400000,
    'mistral-ocr:mistral-ocr-4-1:annotations:page': 500000,
    'mistral-ocr:mistral-ocr-4-0:page': 400000,
    'mistral-ocr:mistral-ocr-4-0:annotations:page': 500000,
    'mistral-ocr:mistral-ocr-2512:page': 200000,
    'mistral-ocr:mistral-ocr-2512:annotations:page': 300000,
} as const;

export type OcrUsageType = keyof typeof OCR_COSTS;
