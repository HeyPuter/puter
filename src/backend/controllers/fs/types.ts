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
import type { FSEntryWriteInput } from '../../stores/fs/FSEntry.js';
import type { WriteGuiMetadata } from './requestTypes.js';

export interface AbortWriteRequest {
    uploadId: string;
}

export type RouteParams = Record<string, string>;

export interface BatchWriteManifestItem {
    index: number;
    fileMetadata: FSEntryWriteInput;
    thumbnailData?: string;
    guiMetadata?: WriteGuiMetadata;
}

export interface BatchWriteManifest {
    items: BatchWriteManifestItem[];
    guiMetadata?: WriteGuiMetadata;
}

export interface ParsedMultipartBatchManifest {
    items: BatchWriteManifestItem[];
    guiMetadata?: WriteGuiMetadata;
    fieldIndexMap: Map<string, number>;
    ignoredItemIndexes: Set<number>;
}

export interface ThumbnailUploadPrepareItem {
    index: number;
    contentType: string;
    size?: number;
    uploadUrl?: string;
    thumbnailUrl?: string;
}

export interface ThumbnailUploadPreparePayload {
    items: ThumbnailUploadPrepareItem[];
}

export interface MultipartBatchFilePart {
    fieldName: string;
    stream: Readable;
    filename?: string;
    mimeType?: string;
}
