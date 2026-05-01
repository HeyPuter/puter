/**
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

// Microcents per page — Textract $1.50/1000 pages = 150,000 µ¢/page.
// Mistral OCR $1/1000 pages, annotations $3/1000 pages.
export const OCR_COSTS = {
    'aws-textract:detect-document-text:page': 150000,
    'mistral-ocr:ocr:page': 100000,
    'mistral-ocr:annotations:page': 300000,
} as const;
