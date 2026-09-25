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

/**
 * `assertCrossAppKvAuthorized` against fake deps — no server needed, since
 * `CrossAppKvDeps` is already the injection seam. Pins that the
 * three-segment-subject hint shows up only when the second segment does not
 * look like an app uid, and that error codes never move.
 */

import { describe, expect, it } from 'vitest';
import { makeActor } from '../../core/actor.js';
import { isHttpError } from '../../core/http/HttpError.js';
import {
    assertCrossAppKvAuthorized,
    type CrossAppKvDeps,
} from './authorization.js';

const actor = makeActor({ user: { id: 1, uuid: 'u-1', username: 'alice' } });

const disabledDeps: CrossAppKvDeps = {
    enabled: false,
    getApp: async () => ({}),
    checkPermission: async () => true,
};

const unknownAppDeps: CrossAppKvDeps = {
    enabled: true,
    getApp: async () => null,
    checkPermission: async () => true,
};

const expectRejection = async (
    promise: Promise<void>,
): Promise<{ message: string; legacyCode?: string }> => {
    try {
        await promise;
    } catch (err) {
        if (!isHttpError(err)) throw err;
        return { message: err.message, legacyCode: err.legacyCode };
    }
    throw new Error('expected assertCrossAppKvAuthorized to reject');
};

describe('assertCrossAppKvAuthorized hint', () => {
    it('adds the hint when the segment does not look like an app uid', async () => {
        const { message, legacyCode } = await expectRejection(
            assertCrossAppKvAuthorized(actor, 'cart', disabledDeps),
        );
        expect(legacyCode).toBe('events_cross_app_disabled');
        expect(message).toContain('three-segment');
    });

    it('omits the hint when the segment is an app uid', async () => {
        const { message, legacyCode } = await expectRejection(
            assertCrossAppKvAuthorized(actor, 'app-abc123', disabledDeps),
        );
        expect(legacyCode).toBe('events_cross_app_disabled');
        expect(message).not.toContain('three-segment');
    });

    it('also adds the hint on the unknown_app path for a non-app-uid segment', async () => {
        const { message, legacyCode } = await expectRejection(
            assertCrossAppKvAuthorized(actor, 'cart', unknownAppDeps),
        );
        expect(legacyCode).toBe('subject_does_not_exist');
        expect(message).toContain('three-segment');
    });

    it('omits the hint on the unknown_app path for an app uid', async () => {
        const { message, legacyCode } = await expectRejection(
            assertCrossAppKvAuthorized(actor, 'app-abc123', unknownAppDeps),
        );
        expect(legacyCode).toBe('subject_does_not_exist');
        expect(message).not.toContain('three-segment');
    });
});
