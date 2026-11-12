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
import { HttpError } from '../../../../core/http/HttpError.js';
import { insufficientCreditsError } from '../../../../services/metering/enforcement.js';
import type { CreditHold } from '../../../../services/metering/types.js';
import { mimeFromName } from '../../../../util/fileSigning.js';
import type { LoadedFile, ResolvedFileInput } from '../../../util/fileInput.js';
import type { AiMeteringService } from '../../shared/aiCostFactor.js';
import {
    OCR_MAX_INPUT_BYTES,
    OCR_MAX_PAGES,
    type OcrProviderId,
} from './models.js';
import { countPdfPages } from './pdfPages.js';

export const badRequest = (message: string) =>
    new HttpError(400, message, { legacyCode: 'bad_request' });

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
 * count, or a size-based guess for other documents, capped by a `pages`
 * selection and by what the provider reads in one call. Reads the input only
 * for a provider that takes more than one page.
 */
export const estimateOcrPages = async (
    input: ResolvedFileInput,
    provider: OcrProviderId,
    selection?: unknown,
): Promise<number> => {
    const maxPages = OCR_MAX_PAGES[provider];
    if (maxPages <= 1) return 1;
    const loaded = await input.load();
    if (!isDocumentInput(loaded)) return 1;
    // A document we can't count is billed in proportion to its size, reaching
    // the provider's page limit at its size limit (20 pages per MB for
    // Mistral). Small files stay cheap; a large one can't pass as one page.
    const documentPages =
        (await countPdfPages(loaded.buffer, maxPages)) ??
        Math.ceil(
            (loaded.buffer.length * maxPages) / OCR_MAX_INPUT_BYTES[provider],
        );
    const selected = Array.isArray(selection)
        ? new Set(
              selection.filter(
                  (page) => Number.isInteger(page) && (page as number) >= 0,
              ),
          ).size
        : 0;
    return Math.max(1, Math.min(documentPages, maxPages, selected || Infinity));
};

/**
 * Refuse a call the balance can't cover, and hold its cost while the provider
 * runs so the account's concurrent calls see it. Usage is still metered from
 * the pages the provider reports.
 */
export const holdOcrCredits = async (
    metering: AiMeteringService,
    actor: Actor,
    usageType: string,
    cost: number,
): Promise<CreditHold> => {
    // Priced at the cost factor usage is recorded at.
    const hold = await metering.reserveAiCredits(actor, usageType, cost);
    if (!hold) throw insufficientCreditsError();
    return hold;
};
