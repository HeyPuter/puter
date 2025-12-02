export interface WorkerInfo {
    name: string;
    url: string;
    file_path?: string;
    file_uid?: string;
    created_at?: string;
    [key: string]: unknown;
}

export interface WorkerDeployment {
    success: boolean;
    url: string;
    errors?: unknown[];
    [key: string]: unknown;
}

export class WorkersHandler {
    constructor (authToken?: string);

    create (workerName: string, filePath: string, appName?: string): Promise<WorkerDeployment>;
    delete (workerName: string): Promise<boolean>;
    exec (request: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    get (workerName: string): Promise<WorkerInfo>;
    list (): Promise<WorkerInfo[]>;
    getLoggingHandle (workerName: string): Promise<EventTarget & { close: () => void }>;
}
