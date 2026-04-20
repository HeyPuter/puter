import type { IConfig, WithLifecycle } from '../types';

export interface IPuterClient<T extends WithLifecycle = WithLifecycle> {
    new (config: IConfig): T;
}

export const PuterClient = class PuterClient implements WithLifecycle {
    constructor(protected config: IConfig) {}
    public onServerStart() {
        return;
    }
    public onServerPrepareShutdown() {
        return;
    }
    public onServerShutdown() {
        return;
    }
} satisfies IPuterClient<WithLifecycle>;

export type IPuterClientRegistry = Record<
    string,
    | IPuterClient<WithLifecycle>
    | (InstanceType<IPuterClient<WithLifecycle>> & Record<string, unknown>)
>;
