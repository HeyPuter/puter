import type { PaginationOptions, RequestCallbacks } from '../shared.d.ts';

export interface AppRecord {
    uid: string;
    name: string;
    index_url: string;
    title?: string;
    description?: string;
    icon?: string;
    maximize_on_start?: boolean;
    background?: boolean;
    filetype_associations?: string[];
    metadata?: Record<string, unknown>;
    created_at?: string;
    open_count?: number;
    user_count?: number;
}

export interface AppListOptions extends PaginationOptions {
    stats_period?: string;
    icon_size?: null | 16 | 32 | 64 | 128 | 256 | 512;
}

export interface CreateAppOptions extends RequestCallbacks<AppRecord> {
    name: string;
    indexURL: string;
    title?: string;
    description?: string;
    icon?: string;
    maximizeOnStart?: boolean;
    background?: boolean;
    filetypeAssociations?: string[];
    metadata?: Record<string, unknown>;
    dedupeName?: boolean;
}

export interface UpdateAppAttributes extends RequestCallbacks<AppRecord> {
    name?: string;
    indexURL?: string;
    title?: string;
    description?: string;
    icon?: string;
    maximizeOnStart?: boolean;
    background?: boolean;
    filetypeAssociations?: string[];
    metadata?: Record<string, unknown>;
}

export class Apps {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    list (options?: AppListOptions): Promise<AppRecord[]>;
    create (name: string, indexURL: string, title?: string): Promise<AppRecord>;
    create (options: CreateAppOptions): Promise<AppRecord>;
    update (name: string, attributes: UpdateAppAttributes): Promise<AppRecord>;
    get (name: string, options?: AppListOptions): Promise<AppRecord>;
    delete (name: string): Promise<{ success?: boolean }>;
    getDeveloperProfile (options?: RequestCallbacks<Record<string, unknown>>): Promise<Record<string, unknown>>;
}
