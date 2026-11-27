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

import { HttpError } from '../../../../core/http/HttpError.js';
import { mimeFromName } from '../../../../util/fileSigning.js';
import type { LoadedFile, ResolvedFileInput } from '../../../util/fileInput.js';
import { OCR_MAX_PAGES, type OcrProviderId } from './models.js';
import { countPdfPages } from './pdfPages.js';

export const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

/** Bounds one Textract request, upload and reply included. */
export const TEXTRACT_UPSTREAM_TIMEOUT_MS = 120_000;

export const inputMimeType = (loaded: LoadedFile): string =>
    loaded.mimeType ??
    mimeFromName(loaded.filename) ??
    'application/octet-stream';

/**
 * Declared documents (PDF, DOCX, PPTX, ...) and PDF bytes are documents; images
 * and untyped bytes are read as a single image.
 */
export const isDocumentInput = (loaded: LoadedFile): boolean => {
    const mime = inputMimeType(loaded);
    return (
        loaded.buffer.subarray(0, 4).toString('latin1') === '%PDF' ||
        loaded.filename.toLowerCase().endsWith('.pdf') ||
        (!mime.startsWith('image/') && mime !== 'application/octet-stream')
    );
};

/**
 * The most pages a call can bill, known before the provider runs: a PDF's page
 * count, capped by a `pages` selection and by what the provider reads in one
 * call. Null for a document whose pages can't be counted, such as a PDF with an
 * encrypted page tree, when no pages are selected. Reads the input only for a
 * provider that takes more than one page.
 */
export const estimateOcrPages = async (
    input: ResolvedFileInput,
    provider: OcrProviderId,
    selection?: unknown,
): Promise<number | null> => {
    const maxPages = OCR_MAX_PAGES[provider];
    if (maxPages <= 1) return 1;
    const loaded = await input.load();
    if (!isDocumentInput(loaded)) return 1;
    const selected = Array.isArray(selection)
        ? new Set(
              selection.filter(
                  (page) => Number.isInteger(page) && (page as number) >= 0,
              ),
          ).size
        : 0;
    const counted = await countPdfPages(loaded.buffer, maxPages);
    if (counted === null && !selected) return null;
    return Math.max(
        1,
        Math.min(counted ?? maxPages, maxPages, selected || Infinity),
    );
};
