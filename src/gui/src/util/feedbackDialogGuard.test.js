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

import { describe, it, expect } from 'vitest';
import { createFeedbackDialogGuard } from './feedbackDialogGuard.js';

// One open-and-close cycle, as the IPC handler runs it.
const cycle = (guard) => {
    if ( ! guard.mayOpen() ) return false;
    guard.markOpened();
    guard.markClosed();
    return true;
};

describe('createFeedbackDialogGuard', () => {
    it('opens the first time', () => {
        expect(createFeedbackDialogGuard().mayOpen()).toBe(true);
    });

    it('reopens every time the user asks, back to back', () => {
        // The whole point: closing the dialog must never cost the user the
        // next one. No dismissal count, no cooldown, no "too soon".
        const guard = createFeedbackDialogGuard();
        for ( let i = 0; i < 20; i++ ) {
            expect(cycle(guard), `open #${i + 1}`).toBe(true);
        }
    });

    it('refuses to stack a second dialog on an open one', () => {
        const guard = createFeedbackDialogGuard();
        expect(guard.mayOpen()).toBe(true);
        guard.markOpened();
        expect(guard.mayOpen()).toBe(false);
    });

    it('opens again as soon as the open one closes', () => {
        const guard = createFeedbackDialogGuard();
        guard.markOpened();
        guard.markClosed();
        expect(guard.mayOpen()).toBe(true);
    });
});
