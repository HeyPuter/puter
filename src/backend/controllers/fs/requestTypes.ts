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

import { FSEntry, FSEntryWriteInput } from '../../stores/fs/FSEntry.js';
import type { Readable } from 'node:stream';

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
