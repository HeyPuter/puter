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

import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { bodyRecord } from './requestBody';

const req = (body: unknown) => ({ body }) as Request;

describe('bodyRecord', () => {
    it('returns an object body as-is', () => {
        const body = { a: 1 };
        expect(bodyRecord(req(body))).toBe(body);
    });

    it('refuses a missing, array or primitive body with 400', () => {
        for (const body of [undefined, null, [], 'text', 3]) {
            expect(() => bodyRecord(req(body))).toThrow(
                expect.objectContaining({
                    statusCode: 400,
                    message: 'body must be an object',
                }),
            );
        }
    });
});
