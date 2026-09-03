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

import { describe, expect, it } from 'vitest';
import {
    EVENTS_NO_CREDIT_BACKLOG_TTL_MS,
    EVENTS_SUSPENDED_BACKLOG_TTL_MS,
    EVENTS_SUSPENDED_PENDING_CAP,
} from '../../controllers/events/limits.js';
import { SUSPENDED_REASONS } from '../../stores/events/DurableSubscriptionStore.js';
import {
    backlogPolicyFor,
    isResumable,
    suspendedFor,
} from './suspension.js';

describe('the backlog a suspension holds', () => {
    it('holds a reduced cap for every reason that can come back', () => {
        for (const reason of ['handler_not_found', 'failures', 'no_credit'] as const) {
            const policy = backlogPolicyFor(reason);
            expect(policy.cap).toBe(EVENTS_SUSPENDED_PENDING_CAP);
            expect(policy.ttlMs).toBeGreaterThan(0);
            expect(policy.resumable).toBe(true);
        }
    });

    it('gives a lapsed balance a shorter window than a bad deploy', () => {
        expect(backlogPolicyFor('handler_not_found').ttlMs).toBe(
            EVENTS_SUSPENDED_BACKLOG_TTL_MS,
        );
        expect(backlogPolicyFor('failures').ttlMs).toBe(
            EVENTS_SUSPENDED_BACKLOG_TTL_MS,
        );
        expect(backlogPolicyFor('no_credit').ttlMs).toBe(
            EVENTS_NO_CREDIT_BACKLOG_TTL_MS,
        );
        expect(backlogPolicyFor('no_credit').ttlMs).toBeLessThan(
            backlogPolicyFor('failures').ttlMs,
        );
    });

    it('keeps nothing at all for a withdrawn grant', () => {
        // The backlog names paths its holder has just lost the right to see,
        // and the suspension by design never lifts.
        expect(backlogPolicyFor('permission_revoked')).toMatchObject({
            cap: 0,
            ttlMs: 0,
            resumable: false,
        });
    });

    it('has a policy for every reason a row can carry', () => {
        for (const reason of SUSPENDED_REASONS)
            expect(backlogPolicyFor(reason)).toBeDefined();
    });
});

describe('what a suspension state answers', () => {
    it('resumes everything but a withdrawn grant', () => {
        expect(isResumable('handler_not_found')).toBe(true);
        expect(isResumable('failures')).toBe(true);
        expect(isResumable('no_credit')).toBe(true);
        expect(isResumable('permission_revoked')).toBe(false);
    });

    it('matches a row against the reason a resume would lift', () => {
        const row = { suspendedAt: 1, suspendedReason: 'handler_not_found' };
        expect(suspendedFor(row, 'handler_not_found')).toBe(true);
        expect(suspendedFor(row, 'no_credit')).toBe(false);
        expect(
            suspendedFor(
                { suspendedAt: null, suspendedReason: null },
                'handler_not_found',
            ),
        ).toBe(false);
    });
});
