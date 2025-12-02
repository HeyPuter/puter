export type AIMessageContent = string | { image_url?: { url: string } } | Record<string, unknown>;

export interface ChatMessage {
    role?: string;
    content: AIMessageContent | AIMessageContent[];
    [key: string]: unknown;
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    vision?: boolean;
    [key: string]: unknown;
}

export interface ChatResponse {
    message?: ChatMessage;
    choices?: unknown;
    [key: string]: unknown;
}

export interface ChatResponseChunk {
    text?: string;
    [key: string]: unknown;
}

export interface Img2TxtOptions {
    source?: string | File | Blob;
    provider?: string;
    testMode?: boolean;
    [key: string]: unknown;
}

export interface Txt2ImgOptions {
    prompt?: string;
    model?: string;
    quality?: string;
    input_image?: string;
    input_image_mime_type?: string;
    [key: string]: unknown;
}

export interface Txt2VidOptions {
    prompt?: string;
    model?: string;
    duration?: number;
    width?: number;
    height?: number;
    fps?: number;
    steps?: number;
    [key: string]: unknown;
}

export interface Txt2SpeechOptions {
    text?: string;
    language?: string;
    voice?: string;
    engine?: string;
    provider?: string;
    model?: string;
    response_format?: string;
    [key: string]: unknown;
}

export interface Txt2SpeechCallable {
    (text: string, options?: Txt2SpeechOptions): Promise<HTMLAudioElement>;
    (text: string, language?: string, voice?: string, engine?: string): Promise<HTMLAudioElement>;
    listEngines: (options?: string | Record<string, unknown>) => Promise<unknown>;
    listVoices: (options?: string | Record<string, unknown>) => Promise<unknown>;
}

export interface Speech2TxtOptions {
    file?: string | File | Blob;
    audio?: string | File | Blob;
    model?: string;
    response_format?: string;
    language?: string;
    prompt?: string;
    stream?: boolean;
    translate?: boolean;
    [key: string]: unknown;
}

export interface Speech2SpeechOptions {
    audio?: string | File | Blob;
    file?: string | File | Blob;
    provider?: string;
    model?: string;
    voice?: string;
    [key: string]: unknown;
}

export class AI {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    listModels (provider?: string): Promise<Record<string, unknown>[]>;
    listModelProviders (): Promise<string[]>;

    chat (prompt: string, options?: ChatOptions): Promise<ChatResponse>;
    chat (prompt: string, imageURL: string | File, options?: ChatOptions): Promise<ChatResponse>;
    chat (messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
    chat (prompt: string, options: ChatOptions & { stream: true }): AsyncIterable<ChatResponseChunk>;
    chat (prompt: string, imageURL: string | File, options: ChatOptions & { stream: true }): AsyncIterable<ChatResponseChunk>;
    chat (messages: ChatMessage[], options: ChatOptions & { stream: true }): AsyncIterable<ChatResponseChunk>;
    chat (...args: unknown[]): Promise<ChatResponse> | AsyncIterable<ChatResponseChunk>;

    img2txt (source: string | File | Blob | Img2TxtOptions, testMode?: boolean): Promise<string>;
    txt2img (prompt: string, testMode?: boolean): Promise<HTMLImageElement>;
    txt2img (prompt: string, options: Txt2ImgOptions): Promise<HTMLImageElement>;
    txt2vid (prompt: string, testMode?: boolean): Promise<HTMLVideoElement>;
    txt2vid (prompt: string, options: Txt2VidOptions): Promise<HTMLVideoElement>;
    speech2txt (source: string | File | Blob | Speech2TxtOptions, options?: Speech2TxtOptions): Promise<string | Record<string, unknown>>;
    speech2speech (source: string | File | Blob | Speech2SpeechOptions, options?: Speech2SpeechOptions): Promise<Record<string, unknown>>;

    txt2speech: Txt2SpeechCallable;
}

// NOTE: AI responses contain provider-specific payloads that are not fully typed here because
// the SDK does not yet publish stable shapes for those fields.
