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

export interface SignedUploadInput {
    bucket: string;
    objectKey: string;
    size: number;
    contentType: string;
    uploadMode: 'single' | 'multipart';
    expiresInSeconds: number;
    multipartPartSize?: number;
}

export interface SignedUploadPart {
    partNumber: number;
    url: string;
}

export interface SignedUploadResult {
    uploadMode: 'single' | 'multipart';
    expiresAt: number;
    url?: string;
    multipartUploadId?: string;
    multipartPartSize?: number;
    multipartPartCount?: number;
    multipartPartUrls?: SignedUploadPart[];
}

export interface MultipartCompletePart {
    partNumber: number;
    etag: string;
}

export interface MultipartCompleteInput {
    bucket: string;
    objectKey: string;
    multipartUploadId: string;
    parts: MultipartCompletePart[];
}

export interface SignedMultipartPartUrlsInput {
    bucket: string;
    objectKey: string;
    multipartUploadId: string;
    partNumbers: number[];
    expiresInSeconds: number;
}

export interface ServerUploadInput {
    bucket: string;
    objectKey: string;
    contentType: string;
    body: Buffer | Uint8Array | string | Readable;
    contentLength?: number;
    sizeHint?: number;
}

export interface GetObjectInput {
    bucket: string;
    objectKey: string;
    range?: string;
}

export interface GetObjectResult {
    body: Readable;
    contentLength: number | null;
    contentType: string | null;
    contentRange: string | null;
    etag: string | null;
    lastModified: Date | null;
}

export interface CopyObjectInput {
    sourceBucket: string;
    sourceKey: string;
    destinationBucket: string;
    destinationKey: string;
    contentType?: string;
    metadataDirective?: 'COPY' | 'REPLACE';
}

export interface DeleteObjectsInput {
    bucket: string;
    objectKeys: string[];
}
