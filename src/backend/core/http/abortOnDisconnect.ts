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

import type { Response } from 'express';
import { HttpError } from './HttpError.js';

/**
 * A signal that fires when the caller hangs up before its response is done, so
 * long-running work can stop (and stop metering). `close` after `finish` is the
 * normal end of a response, not an abort.
 */
export const abortOnDisconnect = (res: Response): AbortSignal => {
    const abort = new AbortController();
    const onClose = () => {
        if (!res.writableFinished) {
            abort.abort(
                new HttpError(400, 'Request aborted', {
                    legacyCode: 'client_aborted',
                    noAlarm: true,
                }),
            );
        }
    };
    if (res.destroyed) onClose();
    else res.once('close', onClose);
    return abort.signal;
};
