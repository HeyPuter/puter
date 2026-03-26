export interface PuterPeerOptions {
    iceServers?: RTCIceServer[];
}

export interface PuterPeerUser {
    username: string;
    uuid: string;
}

export type PuterPeerMessage = string | Blob | ArrayBuffer | ArrayBufferView;
export type PuterPeerDescription = RTCSessionDescription | RTCSessionDescriptionInit;
export type PuterPeerIceCandidate = RTCIceCandidate | RTCIceCandidateInit;

export class PuterPeerServerConnectionEvent extends Event {
    readonly conn: PuterPeerConnection;
    readonly user: PuterPeerUser;
}

export class PuterPeerConnectionMessageEvent extends Event {
    readonly data: ArrayBuffer | string;
}

export class PuterPeerConnectionOpenEvent extends Event {}

export class PuterPeerConnectionCloseEvent extends Event {
    readonly reason?: string;
}

export class PuterPeerConnectionErrorEvent extends Event {
    readonly error: string;
}

export interface PuterPeerServerEventMap {
    connection: PuterPeerServerConnectionEvent;
}

export interface PuterPeerConnectionEventMap {
    open: PuterPeerConnectionOpenEvent;
    message: PuterPeerConnectionMessageEvent;
    close: PuterPeerConnectionCloseEvent;
    error: PuterPeerConnectionErrorEvent;
}

export class PuterPeerServer extends EventTarget {
    inviteCode?: string;
    connections: Map<string, PuterPeerConnection>;

    start (): Promise<string>;
    message (data: ArrayBuffer | string): Promise<void>;

    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    addEventListener<K extends keyof PuterPeerServerEventMap>(
        type: K,
        listener: (this: PuterPeerServer, ev: PuterPeerServerEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    removeEventListener<K extends keyof PuterPeerServerEventMap>(
        type: K,
        listener: (this: PuterPeerServer, ev: PuterPeerServerEventMap[K]) => unknown,
        options?: boolean | EventListenerOptions,
    ): void;
}

export class PuterPeerConnection extends EventTarget {
    peerconnection: RTCPeerConnection;
    owner?: PuterPeerUser;
    connected: boolean;
    closed: boolean;

    connect (invitecode: string): Promise<void>;
    close (reason?: string): void;
    createOffer (): Promise<RTCSessionDescriptionInit>;
    createAnswer (): Promise<RTCSessionDescriptionInit>;
    setRemoteDescription (description: PuterPeerDescription): void;
    addIceCandidate (candidate: PuterPeerIceCandidate): void;
    send (message: PuterPeerMessage): void;

    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    addEventListener<K extends keyof PuterPeerConnectionEventMap>(
        type: K,
        listener: (this: PuterPeerConnection, ev: PuterPeerConnectionEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    removeEventListener<K extends keyof PuterPeerConnectionEventMap>(
        type: K,
        listener: (this: PuterPeerConnection, ev: PuterPeerConnectionEventMap[K]) => unknown,
        options?: boolean | EventListenerOptions,
    ): void;
}

export default class Peer {
    authToken?: string | null;
    APIOrigin: string;
    appID?: string;

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;
    ensureTurnRelays (): Promise<void>;
    serve (options?: PuterPeerOptions): Promise<PuterPeerServer>;
    connect (invitecode: string, options?: PuterPeerOptions): Promise<PuterPeerConnection>;
}
