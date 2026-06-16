import type { RequestCallbacks } from '../shared.d.ts';

export interface AppUser {
    username: string;
    user_uuid: string;
}

export interface GetUsersOptions {
    limit?: number;
    offset?: number;
}

export interface App {
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
    /**
     * Iterates over all users of the app, fetching them page by page.
     * @param pageSize - The number of users to retrieve per page. Default is 100.
     */
    users (pageSize?: number): AsyncIterableIterator<AppUser>;
    /**
     * Retrieves a list of users one page at a time as defined by limit and offset.
     * @param params - Pagination options.
     */
    getUsers (params?: GetUsersOptions): Promise<AppUser[]>;
}

export interface CreateAppResult {
    uid: string;
    name: string;
    title: string;
    index_url: string;
    subdomain: string;
    owner: {
        username: string;
        uuid: string;
    };
}

export interface AppListOptions {
    stats_period?: string;
    icon_size?: null | 16 | 32 | 64 | 128 | 256 | 512;
}

export interface CreateAppOptions {
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

export interface UpdateAppAttributes {
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

export interface CheckAppNameResult {
    name: string;
    available: boolean;
}

export class Apps {
    list (options?: AppListOptions): Promise<App[]>;
    create (name: string, indexURL: string, title?: string): Promise<CreateAppResult>;
    create (options: CreateAppOptions): Promise<CreateAppResult>;
    update (name: string, attributes: UpdateAppAttributes): Promise<App>;
    get (name: string, options?: AppListOptions): Promise<App>;
    delete (name: string): Promise<{ success: boolean; uid: string }>;
    checkName (name: string): Promise<CheckAppNameResult>;
    getDeveloperProfile (options?: RequestCallbacks<Record<string, unknown>>): Promise<Record<string, unknown>>;
    getDeveloperProfile (success: (value: Record<string, unknown>) => void, error?: (reason: unknown) => void): Promise<Record<string, unknown>>;
}
