export type KVValue = string | number | boolean | object | unknown;
export type KVScalar = KVValue | KVValue[];

export interface KVPair<T = unknown> {
    key: string;
    value: T;
}

export interface KVIncrementPath {
    [path: string]: number;
}

export class KV {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    readonly MAX_KEY_SIZE: number;
    readonly MAX_VALUE_SIZE: number;

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    set<T = KVScalar>(key: string, value: T, expireAt?: number): Promise<boolean>;
    get<T = unknown>(key: string): Promise<T | undefined>;
    del (key: string): Promise<boolean>;
    incr (key: string, amount?: number | KVIncrementPath): Promise<number>;
    decr (key: string, amount?: number | KVIncrementPath): Promise<number>;
    expire (key: string, ttlSeconds: number): Promise<boolean>;
    expireAt (key: string, timestampSeconds: number): Promise<boolean>;
    list (pattern?: string, returnValues?: false): Promise<string[]>;
    list<T = unknown>(pattern: string, returnValues: true): Promise<KVPair<T>[]>;
    list<T = unknown>(returnValues: true): Promise<KVPair<T>[]>;
    flush (): Promise<boolean>;
    clear (): Promise<boolean>;
}
