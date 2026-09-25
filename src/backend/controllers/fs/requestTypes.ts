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
import type {
    FSEntry,
    FSEntrySubdomain,
    FSEntryWriteInput,
} from '../../stores/fs/FSEntry.js';

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

/**
 * An `FSEntry` safe to send to a client. Built by allowlist so row ids, storage
 * columns and capability tokens never reach the wire; `shortcutTo` stays
 * because the v1 contract exposes it. The `?: never` members make a raw
 * `FSEntry` fail to typecheck where a `ClientFSEntry` is expected; only the
 * strict `tsconfig.json` catches that, since the build config sets `noCheck`.
 */
export interface ClientFSEntry {
    uuid: string;
    uid: string;
    parentUid: string | null;
    path: string;
    name: string;
    isDir: boolean;
    isShortcut: boolean;
    shortcutTo: number | null;
    isSymlink: boolean;
    symlinkPath: string | null;
    isPublic: boolean | null;
    immutable: boolean;
    metadata: string | null;
    modified: number;
    created: number | null;
    accessed: number | null;
    size: number | null;
    layout: string | null;
    subdomains: FSEntrySubdomain[];
    workers: FSEntrySubdomain[];
    hasWebsite: boolean;
    suggestedApps: unknown[];
    isShared?: boolean | null;

    id?: never;
    userId?: never;
    parentId?: never;
    associatedAppId?: never;
    bucket?: never;
    bucketRegion?: never;
    publicToken?: never;
    fileRequestToken?: never;
}

// Wire counterparts of the write responses: what the controller sends after
// sanitizing, kept distinct so the compiler can tell the two apart.

/**
 * The presigned-upload envelope minus storage internals; the presigned URLs
 * already carry what the store needs.
 */
export type ClientSignedWriteResponse = Omit<
    SignedWriteResponse,
    'fsEntry' | 'bucket' | 'bucketRegion' | 'objectKey'
> & { fsEntry?: ClientFSEntry };

export type ClientSignMultipartPartsResponse = Omit<
    SignMultipartPartsResponse,
    'bucket' | 'bucketRegion' | 'objectKey'
>;

export type ClientCompleteWriteResponse = Omit<
    CompleteWriteResponse,
    'fsEntry'
> & { fsEntry: ClientFSEntry };

export type ClientWriteResponse = Omit<WriteResponse, 'fsEntry'> & {
    fsEntry: ClientFSEntry;
};

/**
 * A sanitized entry plus what a client cannot derive: MIME `type`, a signed
 * `thumbnail` URL, the resolved `associatedApp`.
 */
export type ClientReaddirEntry = ClientFSEntry & {
    type: string | null;
    thumbnail: string | null;
    associatedApp: Record<string, unknown> | null;
};
