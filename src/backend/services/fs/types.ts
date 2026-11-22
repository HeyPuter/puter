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

import type { Readable } from 'node:stream';
import type { FSEntry, FSEntryWriteInput } from '../../stores/fs/FSEntry.js';

export type UploadMode = 'single' | 'multipart';

export interface WriteGuiMetadata {
    originalClientSocketId?: string;
    socketId?: string;
    operationId?: string;
    itemUploadId?: string;
}

export interface ThumbnailUploadMetadata {
    contentType: string;
    size?: number;
}

export interface SignedWriteRequest {
    fileMetadata: FSEntryWriteInput;
    directory?: boolean;
    uploadMode?: UploadMode | 'auto';
    expiresInSeconds?: number;
    thumbnailMetadata?: ThumbnailUploadMetadata;
    guiMetadata?: WriteGuiMetadata;
}

export interface SignedUploadPart {
    partNumber: number;
    url: string;
}

export interface SignedWriteResponse {
    sessionId: string;
    uploadMode: UploadMode;
    objectKey: string;
    /** The uid the entry will carry, which an overwrite already has. */
    entryUid: string;
    bucket: string;
    bucketRegion: string;
    contentType: string;
    expiresAt: number;
    url?: string;
    multipartUploadId?: string;
    multipartPartSize?: number;
    multipartPartCount?: number;
    multipartPartUrls?: SignedUploadPart[];
    directoryCreated?: boolean;
    fsEntry?: FSEntry;
    thumbnailUploadUrl?: string;
    thumbnailUrl?: string;
}

export interface SignMultipartPartsRequest {
    uploadId: string;
    partNumbers: number[];
    expiresInSeconds?: number;
}

export interface SignMultipartPartsResponse {
    uploadId: string;
    multipartUploadId: string;
    objectKey: string;
    bucket: string;
    bucketRegion: string;
    expiresAt: number;
    multipartPartUrls: SignedUploadPart[];
}

export interface CompleteMultipartPart {
    partNumber: number;
    etag: string;
}

export interface CompleteWriteRequest {
    uploadId: string;
    thumbnailData?: string;
    parts?: CompleteMultipartPart[];
    guiMetadata?: WriteGuiMetadata;
}

export interface CompleteWriteResponse {
    sessionId: string;
    fsEntry: FSEntry;
    wasOverwrite: boolean;
    requestedThumbnail?: string | null;
}

export interface BinaryPayload {
    base64: string;
}

export interface WriteRequest {
    fileMetadata: FSEntryWriteInput;
    fileContent:
        | Buffer
        | Readable
        | ReadableStream
        | string
        | Blob
        | File
        | Uint8Array
        | ArrayBuffer
        | BinaryPayload;
    encoding?: 'utf8' | 'base64' | 'ascii' | 'latin1' | 'utf16le' | 'hex';
    thumbnailData?: string;
    guiMetadata?: WriteGuiMetadata;
}

export interface WriteResponse {
    fsEntry: FSEntry;
    wasOverwrite: boolean;
    requestedThumbnail?: string | null;
    contentHashSha256?: string | null;
}

export interface NormalizedWriteInput {
    userId: number;
    path: string;
    size: number;
    contentType: string;
    checksumSha256: string | undefined;
    metadata: string | Record<string, unknown> | null | undefined;
    thumbnail: string | null | undefined;
    associatedAppId: number | null | undefined;
    overwrite: boolean;
    dedupeName: boolean;
    createMissingParents: boolean;
    immutable: boolean;
    isPublic: boolean | null | undefined;
    multipartPartSize: number | undefined;
    bucket: string;
    bucketRegion: string;
}

export interface UploadPayload {
    body: Buffer | Uint8Array | string | Readable;
    contentLength?: number;
    uploadedSize: () => number;
    contentHashSha256: string | null;
    finalizeContentHashSha256?: () => string | null;
    /** Set once a streamed body has outgrown its budget. */
    overflowError?: () => Error | null;
}

/**
 * Bytes a streamed upload may still take before it is refused with
 * `overflow()`. Items of one batch that draw on the same owner's storage share
 * one, so together they stay inside it.
 */
export interface UploadByteBudget {
    remaining: number;
    overflow: () => Error;
}

export interface UploadProgressTrackerLike {
    total: number;
    progress: number;
    setTotal: (total: number) => void;
    add: (amount: number) => void;
    subscribe?: (callback: (delta: number) => void) => unknown;
}

export interface BatchWritePrepareRequest {
    fileMetadata: FSEntryWriteInput;
    thumbnailData?: string;
    guiMetadata?: WriteGuiMetadata;
}

export interface PreparedBatchWriteItem {
    index: number;
    normalizedInput: NormalizedWriteInput;
    existingEntry: FSEntry | null;
    objectKey: string;
    wasOverwrite: boolean;
    requestedThumbnail: string | null | undefined;
    guiMetadata?: WriteGuiMetadata;
}

export interface PreparedBatchWrite {
    userId: number;
    items: PreparedBatchWriteItem[];
    itemsByIndex: Map<number, PreparedBatchWriteItem>;
    storageAllowanceMax?: number;
    /**
     * The owner's storage left after the batch's declared sizes, by item index;
     * set by the allowance check that runs before the uploads.
     */
    storageBudgets?: Map<number, UploadByteBudget>;
}

export interface UploadedBatchWriteItem {
    index: number;
    objectKey: string;
    uploadedSize: number;
    contentHashSha256: string | null;
}

export interface UploadPreparedBatchItemInput {
    preparedBatch: PreparedBatchWrite;
    itemIndex: number;
    fileContent: WriteRequest['fileContent'];
    encoding?: WriteRequest['encoding'];
    uploadTracker?: UploadProgressTrackerLike;
}
