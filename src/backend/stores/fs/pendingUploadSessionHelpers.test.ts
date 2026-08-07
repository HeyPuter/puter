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

import { describe, expect, it } from 'vitest';
import type {
    PendingUploadCreateInput,
    PendingUploadSession,
} from './FSEntry.js';
import {
    isPendingUploadSession,
    normalizePendingUploadSession,
    PENDING_UPLOAD_SESSION_KEY_PREFIX,
    toPendingUploadSession,
    toPendingUploadSessionExpiresAtSeconds,
    toPendingUploadSessionKey,
    withPendingUploadSessionStatus,
} from './pendingUploadSessionHelpers.js';

const createInput: PendingUploadCreateInput = {
    sessionId: 'session-1',
    userId: 42,
    appId: null,
    parentUid: 'parent-uid',
    parentPath: '/alice/Documents',
    targetName: 'a.txt',
    targetPath: '/alice/Documents/a.txt',
    overwriteTargetUid: null,
    contentType: 'text/plain',
    size: 11,
    checksumSha256: null,
    uploadMode: 'single',
    multipartUploadId: null,
    multipartPartSize: null,
    multipartPartCount: null,
    storageProvider: 's3',
    bucket: 'puter-local',
    bucketRegion: 'us-west-2',
    objectKey: 'object-key-1',
    metadataJson: '{}',
    expiresAt: 1_700_000_000_000,
};

const session = (over: Partial<PendingUploadSession> = {}) => ({
    ...toPendingUploadSession(createInput, 1_699_999_000_000),
    ...over,
});

describe('toPendingUploadSessionKey', () => {
    it('namespaces the session id under the upload-session prefix', () => {
        expect(toPendingUploadSessionKey('abc')).toBe(
            `${PENDING_UPLOAD_SESSION_KEY_PREFIX}abc`,
        );
    });
});

describe('toPendingUploadSessionExpiresAtSeconds', () => {
    it('rounds milliseconds up to whole seconds', () => {
        expect(toPendingUploadSessionExpiresAtSeconds(1500)).toBe(2);
        expect(toPendingUploadSessionExpiresAtSeconds(2000)).toBe(2);
    });

    it('never returns a non-positive expiry', () => {
        expect(toPendingUploadSessionExpiresAtSeconds(0)).toBe(1);
        expect(toPendingUploadSessionExpiresAtSeconds(-5000)).toBe(1);
    });
});

describe('toPendingUploadSession', () => {
    it('starts a session pending with matching timestamps and no consumption', () => {
        const now = 1_699_999_000_000;
        const built = toPendingUploadSession(createInput, now);

        expect(built).toMatchObject({
            id: 0,
            sessionId: 'session-1',
            userId: 42,
            targetPath: '/alice/Documents/a.txt',
            objectKey: 'object-key-1',
            status: 'pending',
            failureReason: null,
            createdAt: now,
            updatedAt: now,
            expiresAt: createInput.expiresAt,
            consumedAt: null,
            completedAt: null,
        });
    });
});

describe('isPendingUploadSession', () => {
    it('accepts a well-formed session', () => {
        expect(isPendingUploadSession(session())).toBe(true);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'session'],
        ['a number', 7],
        ['an array', [session()]],
    ])('rejects %s', (_label, value) => {
        expect(isPendingUploadSession(value)).toBe(false);
    });

    it.each([
        'sessionId',
        'userId',
        'status',
        'expiresAt',
        'objectKey',
        'parentPath',
        'targetPath',
    ])('rejects an object missing %s', (field) => {
        const candidate: Record<string, unknown> = { ...session() };
        delete candidate[field];
        expect(isPendingUploadSession(candidate)).toBe(false);
    });

    it('rejects a session whose userId arrived as a string', () => {
        expect(isPendingUploadSession(session({ userId: '42' as never }))).toBe(
            false,
        );
    });
});

describe('normalizePendingUploadSession', () => {
    it('returns null for anything that is not a session', () => {
        expect(normalizePendingUploadSession({ nope: true }, 'x')).toBeNull();
        expect(normalizePendingUploadSession(null, 'x')).toBeNull();
    });

    it('forces the session id to the key it was read under', () => {
        const stored = session({ sessionId: 'stale-id' });
        expect(
            normalizePendingUploadSession(stored, 'session-1')?.sessionId,
        ).toBe('session-1');
    });

    it('defaults missing bookkeeping fields to a coherent shape', () => {
        const before = Date.now();
        const stored: Record<string, unknown> = { ...session() };
        delete stored.id;
        delete stored.createdAt;
        delete stored.updatedAt;
        stored.failureReason = 12;
        stored.consumedAt = 'nope';
        stored.completedAt = null;

        const normalized = normalizePendingUploadSession(stored, 'session-1');

        expect(normalized).not.toBeNull();
        expect(normalized?.id).toBe(0);
        expect(normalized?.failureReason).toBeNull();
        expect(normalized?.consumedAt).toBeNull();
        expect(normalized?.completedAt).toBeNull();
        expect(normalized?.createdAt).toBeGreaterThanOrEqual(before);
        // updatedAt falls back to createdAt, not to a second `Date.now()`.
        expect(normalized?.updatedAt).toBe(normalized?.createdAt);
    });

    it('preserves numeric timestamps that were already stored', () => {
        const stored = session({
            id: 9,
            createdAt: 100,
            updatedAt: 200,
            consumedAt: 300,
            completedAt: 400,
            failureReason: 'boom',
        });

        expect(
            normalizePendingUploadSession(stored, 'session-1'),
        ).toMatchObject({
            id: 9,
            createdAt: 100,
            updatedAt: 200,
            consumedAt: 300,
            completedAt: 400,
            failureReason: 'boom',
        });
    });
});

describe('withPendingUploadSessionStatus', () => {
    it('marks completion by stamping consumedAt and completedAt and clearing the reason', () => {
        const now = 1_700_000_500_000;
        const updated = withPendingUploadSessionStatus(
            session({ failureReason: 'earlier attempt' }),
            'completed',
            'ignored',
            now,
        );

        expect(updated).toMatchObject({
            status: 'completed',
            failureReason: null,
            updatedAt: now,
            consumedAt: now,
            completedAt: now,
        });
    });

    it.each(['failed', 'aborted'] as const)(
        'records the reason for a %s session without consuming it',
        (status) => {
            const now = 1_700_000_600_000;
            const updated = withPendingUploadSessionStatus(
                session(),
                status,
                'upload expired',
                now,
            );

            expect(updated).toMatchObject({
                status,
                failureReason: 'upload expired',
                updatedAt: now,
                consumedAt: null,
                completedAt: null,
            });
        },
    );

    it('re-stamping pending only bumps updatedAt and leaves the reason alone', () => {
        const now = 1_700_000_700_000;
        const updated = withPendingUploadSessionStatus(
            session({ failureReason: 'transient' }),
            'pending',
            'ignored',
            now,
        );

        expect(updated).toMatchObject({
            status: 'pending',
            failureReason: 'transient',
            updatedAt: now,
        });
    });
});
