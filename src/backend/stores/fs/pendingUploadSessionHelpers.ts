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

import { PendingUploadCreateInput, PendingUploadSession } from './FSEntry.js';

export type PendingUploadSessionStatus =
    | 'pending'
    | 'completed'
    | 'failed'
    | 'aborted';

export const PENDING_UPLOAD_SESSION_KEY_PREFIX = 'prodfsv2:upload-session:';

export function toPendingUploadSessionKey(sessionId: string): string {
    return `${PENDING_UPLOAD_SESSION_KEY_PREFIX}${sessionId}`;
}

export function toPendingUploadSessionExpiresAtSeconds(
    expiresAtMs: number,
): number {
    return Math.max(1, Math.ceil(expiresAtMs / 1000));
}

export function toPendingUploadSession(
    input: PendingUploadCreateInput,
    now: number,
): PendingUploadSession {
    return {
        id: 0,
        sessionId: input.sessionId,
        userId: input.userId,
        appId: input.appId,
        parentUid: input.parentUid,
        parentPath: input.parentPath,
        targetName: input.targetName,
        targetPath: input.targetPath,
        overwriteTargetUid: input.overwriteTargetUid,
        contentType: input.contentType,
        size: input.size,
        checksumSha256: input.checksumSha256,
        uploadMode: input.uploadMode,
        multipartUploadId: input.multipartUploadId,
        multipartPartSize: input.multipartPartSize,
        multipartPartCount: input.multipartPartCount,
        storageProvider: input.storageProvider,
        bucket: input.bucket,
        bucketRegion: input.bucketRegion,
        objectKey: input.objectKey,
        status: 'pending',
        failureReason: null,
        metadataJson: input.metadataJson,
        createdAt: now,
        updatedAt: now,
        expiresAt: input.expiresAt,
        consumedAt: null,
        completedAt: null,
    };
}

export function isPendingUploadSession(
    value: unknown,
): value is PendingUploadSession {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
        typeof candidate.sessionId === 'string' &&
        typeof candidate.userId === 'number' &&
        typeof candidate.status === 'string' &&
        typeof candidate.expiresAt === 'number' &&
        typeof candidate.objectKey === 'string' &&
        typeof candidate.parentPath === 'string' &&
        typeof candidate.targetPath === 'string'
    );
}

export function normalizePendingUploadSession(
    value: unknown,
    sessionId: string,
): PendingUploadSession | null {
    if (!isPendingUploadSession(value)) {
        return null;
    }

    const record = value as PendingUploadSession & {
        id?: unknown;
        failureReason?: unknown;
        createdAt?: unknown;
        updatedAt?: unknown;
        consumedAt?: unknown;
        completedAt?: unknown;
    };
    const createdAt =
        typeof record.createdAt === 'number' ? record.createdAt : Date.now();
    const updatedAt =
        typeof record.updatedAt === 'number' ? record.updatedAt : createdAt;

    return {
        ...record,
        id: typeof record.id === 'number' ? record.id : 0,
        sessionId,
        failureReason:
            typeof record.failureReason === 'string'
                ? record.failureReason
                : null,
        createdAt,
        updatedAt,
        consumedAt:
            typeof record.consumedAt === 'number' ? record.consumedAt : null,
        completedAt:
            typeof record.completedAt === 'number' ? record.completedAt : null,
    };
}

export function withPendingUploadSessionStatus(
    session: PendingUploadSession,
    status: PendingUploadSessionStatus,
    reason: string | null,
    now: number,
): PendingUploadSession {
    if (status === 'completed') {
        return {
            ...session,
            status,
            failureReason: null,
            updatedAt: now,
            consumedAt: now,
            completedAt: now,
        };
    }

    if (status === 'failed' || status === 'aborted') {
        return {
            ...session,
            status,
            failureReason: reason,
            updatedAt: now,
        };
    }

    return {
        ...session,
        status,
        updatedAt: now,
    };
}
