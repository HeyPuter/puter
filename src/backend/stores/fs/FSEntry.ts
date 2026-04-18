export interface FSEntry {
    id: number;
    uuid: string;
    uid: string;
    userId: number;
    parentId: number | null;
    parentUid: string | null;
    path: string;
    name: string;
    isDir: boolean;
    bucket: string | null;
    bucketRegion: string | null;
    publicToken: string | null;
    fileRequestToken: string | null;
    isShortcut: boolean;
    shortcutTo: number | null;
    associatedAppId: number | null;
    layout: string | null;
    sortBy: 'name' | 'modified' | 'type' | 'size' | null;
    sortOrder: 'asc' | 'desc' | null;
    isPublic: boolean | null;
    thumbnail: string | null;
    immutable: boolean;
    metadata: string | null;
    modified: number;
    created: number | null;
    accessed: number | null;
    size: number | null;
    symlinkPath: string | null;
    isSymlink: boolean;
}

export interface FSEntryWriteInput {
    path: string;
    size: number;
    contentType?: string;
    checksumSha256?: string;
    metadata?: string | Record<string, unknown> | null;
    thumbnail?: string | null;
    associatedAppId?: number | null;
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
    immutable?: boolean;
    isPublic?: boolean | null;
    multipartPartSize?: number;
    bucket?: string;
    bucketRegion?: string;
}

export interface FSEntryCreateInput extends FSEntryWriteInput {
    userId: number;
    uuid: string;
}

export interface PendingUploadSession {
    id: number;
    sessionId: string;
    userId: number;
    appId: number | null;
    parentUid: string;
    parentPath: string;
    targetName: string;
    targetPath: string;
    overwriteTargetUid: string | null;
    contentType: string;
    size: number;
    checksumSha256: string | null;
    uploadMode: 'single' | 'multipart';
    multipartUploadId: string | null;
    multipartPartSize: number | null;
    multipartPartCount: number | null;
    storageProvider: string;
    bucket: string | null;
    bucketRegion: string | null;
    objectKey: string;
    status: string;
    failureReason: string | null;
    metadataJson: string | null;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    consumedAt: number | null;
    completedAt: number | null;
}

export interface PendingUploadCreateInput {
    sessionId: string;
    userId: number;
    appId: number | null;
    parentUid: string;
    parentPath: string;
    targetName: string;
    targetPath: string;
    overwriteTargetUid: string | null;
    contentType: string;
    size: number;
    checksumSha256: string | null;
    uploadMode: 'single' | 'multipart';
    multipartUploadId: string | null;
    multipartPartSize: number | null;
    multipartPartCount: number | null;
    storageProvider: string;
    bucket: string;
    bucketRegion: string;
    objectKey: string;
    metadataJson: string;
    expiresAt: number;
}
