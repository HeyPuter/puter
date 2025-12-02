export type PuterEnvironment = 'app' | 'gui' | 'web' | 'web-worker' | 'service-worker' | 'nodejs';

export interface RequestCallbacks<T = unknown> {
    success?: (value: T) => void;
    error?: (reason: unknown) => void;
}

export interface APILoggingConfig {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface APICallLogger {
    isEnabled(): boolean;
    logRequest(entry: Record<string, unknown>): void;
    updateConfig(config: APILoggingConfig): void;
    disable(): void;
}

export interface PaginationOptions {
    page?: number;
    per_page?: number;
}

export interface PaginatedResult<T> {
    data: T[];
    page?: number;
    pages?: number;
}

export interface ToolSchema {
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
        strict?: boolean;
    };
    exec: (parameters: Record<string, unknown>) => unknown | Promise<unknown>;
}
