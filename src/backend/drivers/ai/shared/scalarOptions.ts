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
 * Puter is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Puter. If not, see <https://www.gnu.org/licenses/>.
 */

import { HttpError } from '../../../core/http/HttpError.js';

/**
 * False for a value such as `{ "toString": null }`, which throws when code
 * writes it into a message, a header or a form field.
 */
export const convertsToText = (value: unknown): boolean => {
    if (typeof value !== 'object' || value === null) return true;
    try {
        void `${value as never}`;
        void Number(value);
        return true;
    } catch {
        return false;
    }
};

/**
 * Rejects a value that can't be turned into text in an option a driver reads as
 * text, a number or a flag. Any other value is left for the provider, which
 * ignores or refuses it as before.
 */
export const assertScalarOptions = (
    args: object,
    names: readonly string[],
): void => {
    for (const name of names) {
        const value = (args as Record<string, unknown>)[name];
        if (!convertsToText(value)) {
            throw new HttpError(400, `\`${name}\` is not a usable value`, {
                legacyCode: 'bad_request',
            });
        }
    }
};
