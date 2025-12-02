export interface ThreadPost {
    uid?: string;
    parent?: string;
    text?: string;
    [key: string]: unknown;
}

export interface ThreadListResult {
    posts: ThreadPost[];
    total?: number;
    page?: number;
}

export type ThreadSubscriptionHandler = (event: string, data: Record<string, unknown>) => void;

export default class Threads {
    constructor (context: { authToken?: string; APIOrigin: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    create (spec: string | ThreadPost, parent?: string): Promise<ThreadPost>;
    edit (uid: string, spec?: string | ThreadPost): Promise<void>;
    delete (uid: string): Promise<void>;
    list (uid: string, page?: number, options?: Record<string, unknown>): Promise<ThreadListResult>;
    subscribe (uid: string, callback: ThreadSubscriptionHandler): Promise<void>;
}
