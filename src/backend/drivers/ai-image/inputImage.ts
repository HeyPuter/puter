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

/**
 * Shared helpers for `input_images` (image-to-image) handling across image
 * providers. `input_images` is the canonical, cross-provider field; an entry
 * may be a public URL, a data-URI, or raw base64. The string-level helpers live
 * in `drivers/util/imageInput.ts` so video providers share them; this module
 * re-exports them and adds the `IGenerateParams`-shaped validation.
 */

import { HttpError } from '../../core/http/HttpError.js';
import { assertInputImageString } from '../util/imageInput.js';
import type { IGenerateParams } from './types.js';

export {
    assertInputImageString,
    fetchImageAsBase64,
    isHttpUrl,
    parseDataUri,
    toBase64DataUri,
    toUrlOrDataUri,
} from '../util/imageInput.js';

/**
 * Validate `input_image` / `input_images` once, where the driver call arrives.
 * Providers reach for `.startsWith` on these, and several do it without going
 * through the helpers here, so the shape has to be settled before any of them
 * runs.
 */
export function assertInputImagesShape(
    params: Pick<IGenerateParams, 'input_image' | 'input_images'>,
    label: string,
): void {
    if (params.input_image !== undefined && params.input_image !== null) {
        assertInputImageString(params.input_image, label);
    }
    const imgs = params.input_images;
    if (imgs === undefined || imgs === null) return;
    if (!Array.isArray(imgs)) {
        throw new HttpError(400, `${label}: input_images must be an array.`, {
            legacyCode: 'bad_request',
        });
    }
    for (const img of imgs) assertInputImageString(img, label);
}

/**
 * Resolve the single input image for providers that only support one. Throws
 * 400 if `input_images` carries more than one entry. Returns the chosen image
 * string (URL / data-URI / raw base64) or undefined.
 */
export function resolveSingleInputImage(
    params: Pick<IGenerateParams, 'input_image' | 'input_images'>,
    providerLabel: string,
): string | undefined {
    const imgs = params.input_images;
    if (imgs && imgs.length > 1) {
        throw new HttpError(
            400,
            `${providerLabel} supports only a single input image; pass one image via input_image or a single-element input_images.`,
            { legacyCode: 'bad_request' },
        );
    }
    const chosen = params.input_image ?? imgs?.[0];
    return chosen === undefined
        ? undefined
        : assertInputImageString(chosen, providerLabel);
}
