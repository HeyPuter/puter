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

import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '../HttpError';
import { createNotFoundHandler } from './notFoundHandler';

describe('createNotFoundHandler', () => {
    it("forwards an HttpError(404, 'not_found') to next() — does not write the response itself", () => {
        // The handler must NOT call res.json/status — that's the error
        // handler's job, so every failure goes through the same serializer.
        const handler = createNotFoundHandler();
        const next = vi.fn();
        const res = {
            status: vi.fn(),
            json: vi.fn(),
        } as unknown as Response;
        handler({} as Request, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        const err = next.mock.calls[0][0];
        expect(isHttpError(err)).toBe(true);
        expect(err.statusCode).toBe(404);
        expect(err.legacyCode).toBe('not_found');
        // Never wrote a response directly.
        expect((res.status as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
        expect((res.json as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    });
});
