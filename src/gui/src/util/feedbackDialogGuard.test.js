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

const APP = 'app-uid-1';

// A guard on a clock the test drives by hand.
const makeGuard = () => {
    let t = 1_000_000;
    const guard = createFeedbackDialogGuard({ now: () => t });
    return {
        guard,
        advance: (ms) => { t += ms; },
        // One full open-and-dismiss cycle, the user taking `duration` to
        // close the dialog. Returns false if the guard refused to open it.
        cycle: (key = APP, { duration = 5_000, sent = false } = {}) => {
            if ( ! guard.mayOpen(key) ) return false;
            guard.markOpened();
            t += duration;
            guard.markClosed(key, sent);
            return true;
        },
    };
};

describe('createFeedbackDialogGuard', () => {
    it('opens for an app it has never seen', () => {
        const { guard } = makeGuard();
        expect(guard.mayOpen(APP)).toBe(true);
    });

    it('reopens after a dismissal, as many times as the user asks', () => {
        const { guard, cycle, advance } = makeGuard();
        // The bug this guards against: closing the dialog used to cost the
        // app its next open for 10s, then 60s, then the rest of the session.
        for ( let i = 0; i < 5; i++ ) {
            expect(cycle(), `open #${i + 1}`).toBe(true);
            advance(2_000); // the user goes back and clicks "Send feedback"
        }
        expect(guard.mayOpen(APP)).toBe(true);
    });

    it('reopens a second after the dialog closed', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle()).toBe(true);
        advance(1_001);
        expect(guard.mayOpen(APP)).toBe(true);
    });

    it('refuses a second dialog while one is open', () => {
        const { guard } = makeGuard();
        expect(guard.mayOpen(APP)).toBe(true);
        guard.markOpened();
        expect(guard.mayOpen(APP)).toBe(false);
        expect(guard.mayOpen('some-other-app')).toBe(false);
        guard.markClosed(APP, false);
    });

    it('backs off an app that reopens the instant it is dismissed', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle()).toBe(true);
        advance(1);
        expect(guard.mayOpen(APP)).toBe(false);

        // ...and holds it off for the first tier.
        advance(9_000);
        expect(guard.mayOpen(APP)).toBe(false);
    });

    it('escalates while the app keeps hammering, and blocks it for good', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle()).toBe(true);

        // A loop calling every 50ms. Waiting out a backoff is no escape: the
        // attempts made during it are activity of their own, so the next tier
        // applies rather than a clean slate.
        const hammer = (ms) => {
            for ( let elapsed = 0; elapsed < ms; elapsed += 50 ) {
                advance(50);
                if ( guard.mayOpen(APP) ) return true;
            }
            return false;
        };

        expect(hammer(10_000), 'first tier').toBe(false);
        expect(hammer(60_000), 'second tier').toBe(false);
        expect(hammer(10 * 60_000), 'blocked for the session').toBe(false);
    });

    it('lets a hammering app back in once it goes quiet', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle()).toBe(true);
        advance(1);
        expect(guard.mayOpen(APP)).toBe(false); // strike: 10s

        // The user closes the app's own dialog loop by leaving it alone, then
        // comes back later and asks for the form themselves.
        advance(30_000);
        expect(guard.mayOpen(APP)).toBe(true);
    });

    it('keeps each app on its own record', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle('noisy-app')).toBe(true);
        advance(1);
        expect(guard.mayOpen('noisy-app')).toBe(false);
        expect(guard.mayOpen('quiet-app')).toBe(true);
    });

    it('clears the record when the user actually sends feedback', () => {
        const { guard, cycle, advance } = makeGuard();
        expect(cycle()).toBe(true);
        advance(1);
        expect(guard.mayOpen(APP)).toBe(false); // strike: 10s

        advance(30_000);
        expect(cycle(APP, { sent: true })).toBe(true);
        // A send wipes the strikes, so even an immediate reopen is allowed.
        expect(guard.mayOpen(APP)).toBe(true);
    });
});
