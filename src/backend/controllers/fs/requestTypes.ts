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
 * An `FSEntry` as it is safe to hand to a client. Built by an allowlist, so the
 * `fsentries` primary key (`id`) and its `parentId`/`associatedAppId`
 * references, the storage columns (`bucket`, `bucketRegion`), the owning
 * `userId`, and the `publicToken`/`fileRequestToken` capability tokens never
 * reach the wire. Entries are addressed by `uuid`.
 *
 * `shortcutTo` is the one numeric row reference that stays: the v1 contract has
 * always exposed it as `shortcut_to` and the desktop resolves shortcuts through
 * it, so dropping it would break them.
 *
 * The `?: never` members below are guards, not fields: they make a raw
 * `FSEntry` fail to typecheck wherever a `ClientFSEntry` is expected. Without
 * them this type is just a structural subset of `FSEntry`, so an unsanitized
 * row would be silently assignable and the distinction would buy nothing.
 *
 * Checked by `tsc -p tsconfig.json` (the strict config). Note that
 * `tsconfig.build.json` sets `noCheck: true` — it only transpiles, so it will
 * not catch a violation here.
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

    id?: never;
    userId?: never;
    parentId?: never;
    associatedAppId?: never;
    bucket?: never;
    bucketRegion?: never;
    publicToken?: never;
    fileRequestToken?: never;
}

/**
 * Wire counterparts of the write responses. The bare `…Response` types describe
 * what the service produces internally (a real `FSEntry`); these describe what
 * the controller sends after sanitizing. Keeping them distinct is what makes
 * "did this response get sanitized?" a question the compiler answers.
 */
/**
 * The presigned-upload envelope minus the storage internals. A client uploads
 * to the presigned `url` / `multipartPartUrls`, which already carry everything
 * S3 needs, so `bucket`, `bucketRegion`, and `objectKey` are ours to keep —
 * they name where a user's bytes physically live.
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
 * A directory-listing entry: a sanitized entry plus the three fields a client
 * cannot derive on its own — the MIME `type`, a _signed_ `thumbnail` URL (the
 * stored value is an S3 key, which is useless to a client), and the resolved
 * `associatedApp`.
 */
export type ClientReaddirEntry = ClientFSEntry & {
    type: string | null;
    thumbnail: string | null;
    associatedApp: Record<string, unknown> | null;
};
