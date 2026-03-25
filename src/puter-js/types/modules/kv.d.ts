/* eslint-disable no-unused-vars */
export type KVValue = string | number | boolean | object | unknown;
export type KVScalar = KVValue | KVValue[];

export interface KVPair<T = unknown> {
    key: string;
    value: T;
}

export interface KVIncrementPath {
    [path: string]: number;
}

export interface KVUpdatePath {
    [path: string]: KVValue;
}

export interface KVAddPath {
    [path: string]: KVValue | KVValue[];
}

export interface KVListOptions {
    pattern?: string;
    returnValues?: boolean;
    limit?: number;
    cursor?: string;
    optConfig?: KVOptConfig;
}

export type KVListPaginationOptions =
    | { limit: number; cursor?: string }
    | { cursor: string; limit?: number };

export interface KVListPage<T = unknown> {
    items: T[];
    cursor?: string;
}

export interface KVOptConfig {
    appUuid?: string;
}

export class KV {
    readonly MAX_KEY_SIZE: number;
    readonly MAX_VALUE_SIZE: number;

    set<T = KVScalar>(key: string, value: T, optConfig: KVOptConfig): Promise<boolean>;
    set<T = KVScalar>(key: string, value: T, expireAt?: number, optConfig?: KVOptConfig): Promise<boolean>;
    get<T = unknown>(key: string, optConfig?: KVOptConfig): Promise<T | undefined>;
    del (key: string, optConfig?: KVOptConfig): Promise<boolean>;
    incr (key: string, optConfig: KVOptConfig): Promise<number>;
    incr (key: string, amount?: number | KVIncrementPath, optConfig?: KVOptConfig): Promise<number>;
    decr (key: string, optConfig: KVOptConfig): Promise<number>;
    decr (key: string, amount?: number | KVIncrementPath, optConfig?: KVOptConfig): Promise<number>;
    add (key: string, optConfig: KVOptConfig): Promise<KVValue>;
    add (key: string, value?: KVValue | KVAddPath, optConfig?: KVOptConfig): Promise<KVValue>;
    remove (key: string, ...paths: Array<string | KVOptConfig>): Promise<KVValue>;
    update (key: string, pathAndValueMap: KVUpdatePath, optConfig: KVOptConfig): Promise<KVValue>;
    update (key: string, pathAndValueMap: KVUpdatePath, ttlSeconds?: number, optConfig?: KVOptConfig): Promise<KVValue>;
    expire (key: string, ttlSeconds: number, optConfig?: KVOptConfig): Promise<boolean>;
    expireAt (key: string, timestampSeconds: number, optConfig?: KVOptConfig): Promise<boolean>;
    list (pattern?: string, returnValues?: false): Promise<string[]>;
    list<T = unknown>(pattern: string, returnValues: true): Promise<KVPair<T>[]>;
    list<T = unknown>(returnValues: true): Promise<KVPair<T>[]>;
    list (pattern: string, returnValues: boolean, optConfig: KVOptConfig): Promise<string[] | KVPair<unknown>[]>;
    list (pattern: string, optConfig: KVOptConfig): Promise<string[]>;
    list<T = unknown>(returnValues: true, optConfig: KVOptConfig): Promise<KVPair<T>[]>;
    list (options: KVListOptions & KVListPaginationOptions & { returnValues?: false }): Promise<KVListPage<string>>;
    list<T = unknown>(options: KVListOptions & KVListPaginationOptions & { returnValues: true }): Promise<KVListPage<KVPair<T>>>;
    list (options: KVListOptions & { returnValues?: false }): Promise<string[]>;
    list<T = unknown>(options: KVListOptions & { returnValues: true }): Promise<KVPair<T>[]>;
    flush (optConfig?: KVOptConfig): Promise<boolean>;
    clear (optConfig?: KVOptConfig): Promise<boolean>;
}
