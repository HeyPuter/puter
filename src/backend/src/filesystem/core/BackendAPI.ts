import { ISelector } from "./Selector";

type PuterUserID = number;

export const enum FSBackendSupportFlags {
    None = 0,
    
    // Platform-related flags
    PlatformCaseSensitive = 1 << 1,

    // Puter support flags
    // PuterStatOwner indicates the backend can store `user_id`
    PuterStatOwner = 1 << 2,
    // PuterStatApp indicates the backend can store `associated_app_id`
    PuterStatApp = 1 << 3,

    // DetailVerboseReaddir indicates the backend will provide a full
    // stat() result for each entry in readdir().
    DetailVerboseReaddir = 1 << 4,
}

export const enum FSNodeType {
    File,
    Directory,
    PuterShortcut,
    SymbolicLink,
    KVStore,
    Socket,
}

export interface IOverwriteOptions {
    readonly overwrite: boolean;
    UserID: PuterUserID,
}

export interface IWriteOptions extends IOverwriteOptions {
    readonly create: boolean;
}

export interface IDeleteOptions {
    readonly recursive: boolean;
}

export interface IStatOptions {
    followSymlinks?: boolean;
}

export interface IStatResult {
    uuid: string;
    name: string;
    type: FSNodeType;
    size: number;
    mtime: Date;
    ctime: Date;
    atime: Date;
    immutable: boolean;
}

export interface IMiniStatResult {
    uuid: string;
    name: string;
    type: FSNodeType;
}

type ReaddirResult = IMiniStatResult | IStatResult;

export interface IMkdirOptions {
    // Not for permission checks by the storage backend.
    // A supporting storage backend will simply store this and
    // return it in the stat() call.
    UserID: PuterUserID,
}

export interface BackendAPI {
    stat (selector: ISelector, options: IStatOptions): Promise<IStatResult>;
    readdir (selector: ISelector): Promise<[string, ReaddirResult][]>;

    mkdir (selector: ISelector, name: string): Promise<void>;
    copy (from: ISelector, to: ISelector, options: IOverwriteOptions): Promise<void>;
    rename (from: ISelector, to: ISelector, options: IOverwriteOptions): Promise<void>;
    delete (selector: ISelector, options: IDeleteOptions): Promise<void>;

    read_file (selector: ISelector): Promise<Buffer>;
    write_file (selector: ISelector, data: Buffer, options: IOverwriteOptions): Promise<void>;
}
