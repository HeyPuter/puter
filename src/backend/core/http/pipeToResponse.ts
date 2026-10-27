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
import type { Readable } from 'node:stream';

/**
 * Streams `body` into the response. A body that fails mid-stream cuts the
 * response off, and a response that closes first releases the body. Resolves
 * once the response is done with the body; never rejects.
 */
export const pipeToResponse = (
    body: Readable,
    res: Response,
): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    body.on('error', (err) => res.destroy(err));
    if (res.destroyed) {
        body.destroy();
        resolve();
        return promise;
    }
    // `pipe` unpipes once the response finishes, closes or fails, so this
    // needs no 'close' listener of its own on top of the one `pipe` adds.
    res.once('unpipe', () => {
        if (!body.readableEnded) body.destroy();
        resolve();
    });
    body.pipe(res);
    return promise;
};
