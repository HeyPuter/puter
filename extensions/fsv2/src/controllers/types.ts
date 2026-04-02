import type { Readable } from 'node:stream';
import type { FSEntryWriteInput } from '../types/FSEntry.js';
import type { WriteGuiMetadata } from '../types/requests.js';

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
