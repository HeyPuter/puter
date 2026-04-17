export interface OuterGuiItemEventResponse {
    path?: string;
    old_path?: string;
    uid?: string;
    uuid?: string;
    id?: string;
}

export interface OuterGuiItemEventPayload {
    user_id_list?: Array<number | string>;
    response?: OuterGuiItemEventResponse;
}

export interface FsRemoveNodeTarget {
    get?: (key: string) => Promise<unknown> | unknown;
}

export interface FsRemoveNodeEventPayload {
    target?: FsRemoveNodeTarget;
}
