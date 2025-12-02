import type { ReaddirOptions, WriteOptions } from './filesystem.d.ts';

export interface FileSignatureInfo {
    read_url?: string;
    write_url?: string;
    metadata_url?: string;
    fsentry_accessed?: number;
    fsentry_modified?: number;
    fsentry_created?: number;
    fsentry_is_dir?: boolean;
    fsentry_size?: number | null;
    fsentry_name?: string;
    path?: string;
    uid?: string;
}

export interface InternalFSProperties {
    signature?: string | null;
    expires?: string | null;
    file_signature: FileSignatureInfo;
}

export class FSItem {
    constructor (options: Record<string, unknown>);

    readURL?: string;
    writeURL?: string;
    metadataURL?: string;
    name: string;
    uid: string;
    id: string;
    uuid: string;
    path: string;
    size: number | null;
    accessed?: number;
    modified?: number;
    created?: number;
    isDirectory: boolean;
    _internalProperties?: InternalFSProperties;

    write (data: Blob | File | ArrayBuffer | ArrayBufferView | string): Promise<FSItem>;
    rename (newName: string): Promise<FSItem>;
    move (destination: string, overwrite?: boolean, newName?: string): Promise<FSItem>;
    copy (destinationDirectory: string, autoRename?: boolean, overwrite?: boolean): Promise<FSItem>;
    delete (): Promise<void>;
    mkdir (name: string, autoRename?: boolean): Promise<FSItem>;
    readdir (options?: ReaddirOptions): Promise<FSItem[]>;
    read (): Promise<Blob>;

    // Placeholders that are not implemented in the runtime SDK yet.
    watch (callback: (item: FSItem) => void): void;
    open (callback: (item: FSItem) => void): void;
    setAsWallpaper (options?: Record<string, unknown>, callback?: () => void): void;
    versions (): Promise<unknown>;
    trash (): Promise<unknown>;
    metadata (): Promise<unknown>;
}
