export class UtilRPC {
    callbackManager: unknown;
    getDehydrator (): { dehydrate(value: unknown): unknown };
    getHydrator (config: { target: Window | Worker | MessagePort }): { hydrate(value: unknown): unknown };
    registerCallback (resolve: (value: unknown) => void): string;
    send (target: Window | Worker | MessagePort, id: string, ...args: unknown[]): void;
}

export default class Util {
    rpc: UtilRPC;
}
