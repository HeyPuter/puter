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

import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { describe, expect, it } from 'vitest';
import { abortOnDisconnect } from './abortOnDisconnect.js';

describe('abortOnDisconnect', () => {
    it('cancels immediately when the caller already disconnected', () => {
        const res = Object.assign(new EventEmitter(), {
            writableFinished: false,
            destroyed: true,
        });
        const signal = abortOnDisconnect(res as unknown as Response);
        expect(signal.aborted).toBe(true);
        expect(signal.reason.noAlarm).toBe(true);
    });

    it('classifies a premature close as an unalarmed client cancellation', () => {
        const res = Object.assign(new EventEmitter(), {
            writableFinished: false,
        });
        const signal = abortOnDisconnect(res as unknown as Response);
        res.emit('close');
        expect(signal.aborted).toBe(true);
        expect(signal.reason).toMatchObject({
            statusCode: 400,
            legacyCode: 'client_aborted',
            noAlarm: true,
        });
    });

    it('does not cancel after a completed response closes', () => {
        const res = Object.assign(new EventEmitter(), {
            writableFinished: true,
        });
        const signal = abortOnDisconnect(res as unknown as Response);
        res.emit('close');
        expect(signal.aborted).toBe(false);
    });
});
