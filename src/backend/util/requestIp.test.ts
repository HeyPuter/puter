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
import { requestIp } from './requestIp.js';

const req = (fields: Record<string, unknown>) => fields as unknown as Request;

describe('requestIp', () => {
    it('prefers req.ip, then the socket address, else null', () => {
        expect(
            requestIp(
                req({ ip: '203.0.113.7', socket: { remoteAddress: '::1' } }),
            ),
        ).toBe('203.0.113.7');
        expect(requestIp(req({ socket: { remoteAddress: '::1' } }))).toBe(
            '::1',
        );
        expect(requestIp(req({ ip: '' }))).toBeNull();
    });
});
