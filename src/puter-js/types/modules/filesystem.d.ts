import type { RequestCallbacks } from '../shared.d.ts';
import type { FSItem } from './fs-item.d.ts';

export interface SpaceInfo {
    capacity: number;
    used: number;
}

export interface CopyOptions extends RequestCallbacks<FSItem> {
    source: string;
    destination: string;
    overwrite?: boolean;
    newName?: string;
    createMissingParents?: boolean;
    dedupeName?: boolean;
    newMetadata?: Record<string, unknown>;
    excludeSocketID?: string;
}

export interface MoveOptions extends RequestCallbacks<FSItem> {
    source: string;
    destination: string;
    overwrite?: boolean;
    newName?: string;
    createMissingParents?: boolean;
    newMetadata?: Record<string, unknown>;
    excludeSocketID?: string;
}

export interface MkdirOptions extends RequestCallbacks<FSItem> {
    path?: string;
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
}

export interface DeleteOptions extends RequestCallbacks<void> {
    path?: string;
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
    newName: string;
}

export interface UploadOptions extends RequestCallbacks<FSItem[]> {
    overwrite?: boolean;
    dedupeName?: boolean;
    name?: string;
    parsedDataTransferItems?: boolean;
    createFileParent?: boolean;
    init?: (operationId: string, xhr: XMLHttpRequest) => void;
    error?: (e: unknown) => void;
}

export interface WriteOptions extends RequestCallbacks<FSItem> {
    overwrite?: boolean;
    dedupeName?: boolean;
    createMissingParents?: boolean;
    name?: string;
}

export interface SignResult<T = Record<string, unknown>> {
    token: string;
    items: T | T[];
}

export class PuterJSFileSystemModule {
    constructor (context: Record<string, unknown>);

    space (options?: RequestCallbacks<SpaceInfo>): Promise<SpaceInfo>;
    mkdir (pathOrOptions: string | MkdirOptions, options?: MkdirOptions): Promise<FSItem>;
    copy (sourceOrOptions: string | CopyOptions, destination?: string, options?: CopyOptions): Promise<FSItem>;
    rename (pathOrUid: string, newName: string, options?: RenameOptions): Promise<FSItem>;
    upload (items: FileList | File[] | Blob[] | Blob | string | unknown[], dirPath?: string, options?: UploadOptions): Promise<FSItem[]>;
    read (pathOrOptions: string | ReadOptions, options?: ReadOptions): Promise<Blob>;
    delete (pathOrOptions: string | DeleteOptions, options?: DeleteOptions): Promise<void>;
    move (sourceOrOptions: string | MoveOptions, destination?: string, options?: MoveOptions): Promise<FSItem>;
    write (path: string, data?: string | File | Blob | ArrayBuffer | ArrayBufferView, options?: WriteOptions): Promise<FSItem>;
    sign (appUid: string, items: unknown | unknown[], success?: (result: SignResult) => void, error?: (reason: unknown) => void): Promise<SignResult>;
    symlink (targetPath: string, linkPath: string, options?: Record<string, unknown>): Promise<FSItem>;
    getReadURL (path: string, expiresIn?: number): Promise<string>;
    readdir (pathOrOptions?: string | ReaddirOptions, options?: ReaddirOptions): Promise<FSItem[]>;
    stat (pathOrUid: string, options?: Record<string, unknown>): Promise<FSItem>;

    FSItem: typeof FSItem;
}
