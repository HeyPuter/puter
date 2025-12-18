export interface WorkerInfo {
    name: string;
    url: string;
    file_path: string;
    file_uid: string;
    created_at: string;
}

export interface WorkerDeployment {
    success: boolean;
    url: string;
    errors?: string[];
}

export class WorkersHandler {
    create (workerName: string, filePath: string, appName?: string): Promise<WorkerDeployment>;
    delete (workerName: string): Promise<boolean>;
    exec (request: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    get (workerName: string): Promise<WorkerInfo | undefined>;
    list (): Promise<WorkerInfo[]>;
    getLoggingHandle (workerName: string): Promise<EventTarget & {
        close: () => void;
        onLog: (event: MessageEvent) => void;
    }>;
}
