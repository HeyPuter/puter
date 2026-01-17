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
}

export type KVListPaginationOptions =
    | { limit: number; cursor?: string }
    | { cursor: string; limit?: number };

export interface KVListPage<T = unknown> {
    items: T[];
    cursor?: string;
}

export class KV {
    readonly MAX_KEY_SIZE: number;
    readonly MAX_VALUE_SIZE: number;

    set<T = KVScalar>(key: string, value: T, expireAt?: number): Promise<boolean>;
    get<T = unknown>(key: string): Promise<T | undefined>;
    del (key: string): Promise<boolean>;
    incr (key: string, amount?: number | KVIncrementPath): Promise<number>;
    decr (key: string, amount?: number | KVIncrementPath): Promise<number>;
    add (key: string, value?: KVValue | KVAddPath): Promise<KVValue>;
    remove (key: string, ...paths: string[]): Promise<KVValue>;
    update (key: string, pathAndValueMap: KVUpdatePath, ttlSeconds?: number): Promise<KVValue>;
    expire (key: string, ttlSeconds: number): Promise<boolean>;
    expireAt (key: string, timestampSeconds: number): Promise<boolean>;
    list (pattern?: string, returnValues?: false): Promise<string[]>;
    list<T = unknown>(pattern: string, returnValues: true): Promise<KVPair<T>[]>;
    list<T = unknown>(returnValues: true): Promise<KVPair<T>[]>;
    list (options: KVListOptions & KVListPaginationOptions & { returnValues?: false }): Promise<KVListPage<string>>;
    list<T = unknown>(options: KVListOptions & KVListPaginationOptions & { returnValues: true }): Promise<KVListPage<KVPair<T>>>;
    list (options: KVListOptions & { returnValues?: false }): Promise<string[]>;
    list<T = unknown>(options: KVListOptions & { returnValues: true }): Promise<KVPair<T>[]>;
    flush (): Promise<boolean>;
    clear (): Promise<boolean>;
}
