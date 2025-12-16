export type SocketEvent =
    | 'open'
    | 'data'
    | 'error'
    | 'close'
    | 'drain'
    | 'tlsdata'
    | 'tlsopen'
    | 'tlsclose';

export class PSocket {
    constructor (host: string, port: number);
    write (data: ArrayBuffer | ArrayBufferView | string, callback?: () => void): void;
    close (): void;
    on (event: 'open', handler: () => void): void;
    on (event: 'data', handler: (buffer: Uint8Array) => void): void;
    on (event: 'error', handler: (reason: string) => void): void;
    on (event: 'close', handler: (hadError: boolean) => void): void;
    addListener (event: SocketEvent, handler: (...args: unknown[]) => void): void;
}

export class PTLSSocket extends PSocket {
    constructor (host: string, port: number);
}

export interface Networking {
    generateWispV1URL(): Promise<string>;
    Socket: typeof PSocket;
    tls: {
        TLSSocket: typeof PTLSSocket;
    };
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}
