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
}
