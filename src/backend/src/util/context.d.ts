import { AsyncLocalStorage } from 'async_hooks';
import { Actor } from '../services/auth/Actor';

type AnyRecord = Record<string, unknown>;

interface ContextCreateHookPayload {
    values: AnyRecord;
    name?: string;
}

interface ContextArunHookPayload {
    hints: AnyRecord;
    name?: string;
    trace_name?: string;
    replace_callback: (cb: () => unknown | Promise<unknown>) => void;
    callback: () => unknown | Promise<unknown>;
}

declare interface IContext {
    get (): Context;
    get (k: 'actor'): Actor;
    get<T = unknown>(k?: string, options?: { allow_fallback?: boolean }): T;
}

declare class Context {
    static USE_NAME_FALLBACK: Record<string, never>;
    static next_name_: number;
    static other_next_names_: Record<string, number>;
    static context_hooks_: {
        pre_create: Array<(payload: ContextCreateHookPayload) => void>;
        post_create: unknown[];
        pre_arun: Array<(payload: ContextArunHookPayload) => void>;
    };
    static contextAsyncLocalStorage: AsyncLocalStorage<Map<string, unknown>>;
    static __last_context_key: number;
    static make_context_key (opt_human_readable?: string): string;
    static create<T extends AnyRecord>(values: T, opt_name?: string): Context;
    static get: IContext['get'];
    static set (k: string, v: unknown): void;
    static root: Context;
    static describe (): string;
    static arun<T = unknown>(...args: unknown[]): Promise<T>;
    static sub (values: AnyRecord | string, opt_name?: string): Context;

    trace_name?: string;
    name?: string;

    constructor (imm_values: AnyRecord, opt_parent?: Context, opt_name?: string);
    unlink (): void;
    get: IContext['get'];
    set (k: string, v: unknown): void;
    sub (values: AnyRecord | string, opt_name?: string): Context;
    get values (): AnyRecord;
    get_proxy_object (): AnyRecord;
    arun<T = unknown>(...args: unknown[]): Promise<T>;
    abind<T = unknown>(cb: (...args: unknown[]) => T | Promise<T>): (...args: unknown[]) => Promise<T>;
    describe (): string;
    describe_ (): string;
    static allow_fallback<T>(cb: () => Promise<T> | T): Promise<T>;
}

declare class ContextExpressMiddleware {
    constructor (args: { parent: Context });
    install (app: { use: (handler: (...args: unknown[]) => void) => void }): void;
    run (req: AnyRecord, res: AnyRecord, next: (...args: unknown[]) => void): Promise<void>;
}

declare const context_config: { strict?: boolean } & AnyRecord;

export { Context, context_config, ContextExpressMiddleware };
