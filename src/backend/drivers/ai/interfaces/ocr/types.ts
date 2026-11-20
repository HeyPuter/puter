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

import type { Actor } from '../../../../core/actor.js';
import type { ResolvedFileInput } from '../../../util/fileInput.js';
import type { OcrModel } from './models.js';

export interface RecognizeArgs {
    source?: unknown;
    file?: unknown;
    provider?: string;
    model?: string;
    // Mistral-specific options — ignored by Textract.
    pages?: number[];
    includeImageBase64?: boolean;
    imageLimit?: number;
    imageMinSize?: number;
    bboxAnnotationFormat?: unknown;
    documentAnnotationFormat?: unknown;
    documentAnnotationPrompt?: string;
    tableFormat?: string;
    extractHeader?: boolean;
    extractFooter?: boolean;
    test_mode?: boolean;
}

/** One recognized line, in the same shape for every provider. */
export interface OcrBlock {
    type: string;
    text: string;
    confidence?: number;
    page: number;
}

/** One vendor's OCR, bound to the credentials this deployment configured. */
export interface IOcrProvider {
    /**
     * Recognizes one input with one of this provider's models: holds the
     * estimated cost while the vendor runs, then meters the pages it reports.
     */
    recognize(
        input: ResolvedFileInput,
        args: RecognizeArgs,
        model: OcrModel,
        actor: Actor,
    ): Promise<unknown>;
}
