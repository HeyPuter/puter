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

import type { FSEntrySubdomain } from '../../stores/fs/FSEntry.js';
import type {
    CompleteWriteResponse,
    SignedWriteResponse,
    SignMultipartPartsResponse,
    WriteResponse,
} from '../../services/fs/types.js';

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
