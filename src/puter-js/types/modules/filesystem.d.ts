import type { RequestCallbacks } from '../shared.d.ts';
import type { FSItem } from './fs-item.d.ts';

export interface SpaceInfo {
    capacity: number;
    used: number;
}

export interface CopyOptions extends RequestCallbacks<FSItem> {
    source?: string;
    destination?: string;
    overwrite?: boolean;
    newName?: string;
    createMissingParents?: boolean;
    dedupeName?: boolean;
    newMetadata?: Record<string, unknown>;
    excludeSocketID?: string;
    original_client_socket_id?: string;
}

export interface MoveOptions extends RequestCallbacks<FSItem> {
    source?: string;
    destination?: string;
    overwrite?: boolean;
    newName?: string;
    createMissingParents?: boolean;
    newMetadata?: Record<string, unknown>;
    excludeSocketID?: string;
    original_client_socket_id?: string;
}

export interface MkdirOptions extends RequestCallbacks<FSItem> {
    path?: string;
    overwrite?: boolean;
    dedupeName?: boolean;
    rename?: boolean;
    createMissingParents?: boolean;
    recursive?: boolean;
    shortcutTo?: string;
}

export interface DeleteOptions extends RequestCallbacks<void> {
    paths?: string | string[];
    recursive?: boolean;
    descendantsOnly?: boolean;
}

export interface ReadOptions extends RequestCallbacks<Blob> {
    path?: string;
    offset?: number;
    byte_count?: number;
}

export interface ReaddirOptions extends RequestCallbacks<FSItem[]> {
    path?: string;
    uid?: string;
    no_thumbs?: boolean;
    no_assocs?: boolean;
    consistency?: 'strong' | 'eventual';
}

export interface RenameOptions extends RequestCallbacks<FSItem> {
    uid?: string;
    path?: string;
    newName?: string;
    excludeSocketID?: string;
    original_client_socket_id?: string;
}

export interface StatOptions extends RequestCallbacks<FSItem> {
    path?: string;
    uid?: string;
    consistency?: 'strong' | 'eventual';
    returnSubdomains?: boolean;
    returnPermissions?: boolean;
    returnVersions?: boolean;
    returnSize?: boolean;
}

export interface UploadOptions extends RequestCallbacks<FSItem | FSItem[]> {
    overwrite?: boolean;
    dedupeName?: boolean;
    name?: string;
    parsedDataTransferItems?: boolean;
    createFileParent?: boolean;
    createMissingAncestors?: boolean;
    createMissingParents?: boolean;
    shortcutTo?: string;
    appUID?: string;
    strict?: boolean;
    init?: (operationId: string, xhr: XMLHttpRequest) => void;
    start?: () => void;
    progress?: (operationId: string, progress: number) => void;
    abort?: (operationId: string) => void;
}

export interface WriteOptions extends RequestCallbacks<FSItem> {
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
    createMissingAncestors?: boolean;
    init?: (operationId: string, xhr: XMLHttpRequest) => void;
    start?: () => void;
    progress?: (operationId: string, progress: number) => void;
    abort?: (operationId: string) => void;
}

export interface SignResult<T = Record<string, unknown>> {
    token: string;
    items: T | T[];
}

export type UploadItems = DataTransferItemList | DataTransferItem | FileList | File[] | Blob[] | Blob | File | string | unknown[];

export class FS {
    space (): Promise<SpaceInfo>;
    space (options: RequestCallbacks<SpaceInfo>): Promise<SpaceInfo>;
    space (success: (value: SpaceInfo) => void, error?: (reason: unknown) => void): Promise<SpaceInfo>;

    mkdir (options: MkdirOptions): Promise<FSItem>;
    mkdir (path: string, options?: MkdirOptions): Promise<FSItem>;
    mkdir (path: string, options: MkdirOptions, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;
    mkdir (path: string, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    copy (options: CopyOptions): Promise<FSItem>;
    copy (source: string, destination: string, options?: CopyOptions): Promise<FSItem>;
    copy (source: string, destination: string, options: CopyOptions | undefined, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    move (options: MoveOptions): Promise<FSItem>;
    move (source: string, destination: string, options?: MoveOptions): Promise<FSItem>;

    rename (options: RenameOptions): Promise<FSItem>;
    rename (path: string, newName: string, success?: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    read (options: ReadOptions): Promise<Blob>;
    read (path: string, options?: ReadOptions): Promise<Blob>;
    read (path: string, success: (value: Blob) => void, error?: (reason: unknown) => void): Promise<Blob>;

    readdir (options: ReaddirOptions): Promise<FSItem[]>;
    readdir (path: string, success?: (value: FSItem[]) => void, error?: (reason: unknown) => void): Promise<FSItem[]>;

    stat (options: StatOptions): Promise<FSItem>;
    stat (path: string, options?: StatOptions): Promise<FSItem>;
    stat (path: string, options: StatOptions, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;
    stat (path: string, success: (value: FSItem) => void, error?: (reason: unknown) => void): Promise<FSItem>;

    delete (options: DeleteOptions): Promise<void>;
    delete (paths: string | string[], options?: DeleteOptions): Promise<void>;

    upload (items: UploadItems, dirPath?: string, options?: UploadOptions): Promise<FSItem | FSItem[]>;

    write (file: File): Promise<FSItem>;
    write (path: string, data: string | File | Blob | ArrayBuffer | ArrayBufferView, options?: WriteOptions): Promise<FSItem>;

    sign (appUid: string, items: unknown | unknown[], success?: (result: SignResult) => void, error?: (reason: unknown) => void): Promise<SignResult>;

    symlink (target: string, linkPath: string): Promise<void>;

    getReadURL (path: string, expiresIn?: string): Promise<string>;
}
