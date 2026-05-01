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

import type { Readable } from 'node:stream';
import type { FSEntry, FSEntryWriteInput } from '../../stores/fs/FSEntry.js';
import type {
    WriteGuiMetadata,
    WriteRequest,
} from '../../controllers/fs/requestTypes.js';

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
