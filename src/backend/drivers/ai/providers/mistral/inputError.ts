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

import { MistralError } from '@mistralai/mistralai/models/errors/mistralerror.js';
import { SDKValidationError } from '@mistralai/mistralai/models/errors/sdkvalidationerror.js';

/**
 * True when the SDK refused the request's input before sending it, which it
 * reports without a status. ResponseValidationError matches the same class but
 * is a MistralError: an unparseable upstream answer, not the caller's fault.
 */
export const isMistralInputError = (error: unknown): boolean =>
    error instanceof SDKValidationError && !(error instanceof MistralError);
