export type AIMessageContent = string | { image_url?: { url: string } } | Record<string, unknown>;

export interface ChatMessage {
    role?: string;
    content: AIMessageContent | AIMessageContent[];
    tool_calls?: ToolCall[];
}

export interface ToolCall {
    id: string;
    function: { name: string, arguments: string };
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    vision?: boolean;
    driver?: string;
    tools?: unknown;
    response?: unknown;
    reasoning?: unknown;
    reasoning_effort?: string;
    text?: unknown;
    verbosity?: unknown;
}

export interface StreamingChatOptions extends ChatOptions {
    stream: boolean;
}

export interface ChatResponse {
    message?: ChatMessage;
    choices?: unknown;
}

export interface ChatResponseChunk {
    text?: string;
    reasoning?: string;
}

export interface Img2TxtOptions {
    source?: string | File | Blob;
    provider?: string;
    testMode?: boolean;
    model?: string;
    pages?: number[];
    includeImageBase64?: boolean;
    imageLimit?: number;
    imageMinSize?: number;
    bboxAnnotationFormat?: string;
    documentAnnotationFormat?: string;
}

export interface Txt2ImgOptions {
    prompt?: string;
    model?: string;
    quality?: string;
    input_image?: string;
    input_image_mime_type?: string;
    driver?: string;
    provider?: string;
    service?: string;
    ratio?: { w: number; h: number };
    width?: number;
    height?: number;
    aspect_ratio?: string;
    steps?: number;
    seed?: number;
    negative_prompt?: string;
    n?: number;
    image_url?: string;
    image_base64?: string;
    mask_image_url?: string;
    mask_image_base64?: string;
    prompt_strength?: number;
    disable_safety_checker?: boolean;
    response_format?: string;
    test_mode?: boolean;
}

export interface Txt2VidOptions {
    prompt?: string;
    provider?: string;
    model?: string;
    seconds?: number;
    test_mode?: boolean;

    // OpenAI options
    size?: string;
    resolution?: string;
    input_reference?: File;

    // TogetherAI options
    width?: number;
    height?: number;
    fps?: number;
    steps?: number;
    guidance_scale?: number;
    seed?: number;
    output_format?: string;
    output_quality?: number;
    negative_prompt?: string;
    reference_images?: string[];
    frame_images?: Array<{ input_image: string; frame: number }>;
    metadata?: Record<string, unknown>;
}

export interface Txt2SpeechOptions {
    text?: string;
    language?: string;
    voice?: string;
    engine?: string;
    provider?: string;
    model?: string;
    response_format?: string;
    output_format?: string;
    instructions?: string;
    voice_settings?: Record<string, unknown>;
    ssml?: boolean;
    test_mode?: boolean;
}

export interface Speech2TxtResult {
    text: string;
    language: string;
    segments?: Record<string, unknown>[];
}

interface BaseSpeech2TxtOptions {
    file?: string | File | Blob;
    audio?: string | File | Blob;
    model?: string;
    language?: string;
    prompt?: string;
    stream?: boolean;
    translate?: boolean;
    temperature?: number;
    logprobs?: boolean;
    timestamp_granularities?: string[];
    chunking_strategy?: string;
    known_speaker_names?: string[];
    known_speaker_references?: string[];
    extra_body?: Record<string, unknown>;
    test_mode?: boolean;
}

export interface TextFormatSpeech2TxtOptions extends BaseSpeech2TxtOptions {
    response_format: "text";
}

export interface Speech2TxtOptions extends BaseSpeech2TxtOptions {
    response_format?: Exclude<string, "text">;
}

export interface Speech2SpeechOptions {
    audio?: string | File | Blob;
    file?: string | File | Blob;
    provider?: string;
    model?: string;
    voice?: string;
    output_format?: string;
    voice_settings?: Record<string, unknown>;
    seed?: number;
    file_format?: string;
    remove_background_noise?: boolean;
    optimize_streaming_latency?: number;
    enable_logging?: boolean;
    test_mode?: boolean;
}

export class AI {
    listModels (provider?: string): Promise<Record<string, unknown>[]>;
    listModelProviders (): Promise<string[]>;

    chat (prompt: string, testMode?: boolean): Promise<ChatResponse>;
    chat (prompt: string, options: ChatOptions, testMode?: boolean): Promise<ChatResponse>;
    chat (prompt: string, imageURL: string | File, testMode?: boolean): Promise<ChatResponse>;
    chat (prompt: string, imageURLArray: string[], testMode?: boolean): Promise<ChatResponse>;
    chat (prompt: string, imageURL: string | File, options: ChatOptions, testMode?: boolean): Promise<ChatResponse>;
    chat (prompt: string, imageURLArray: string[], options: ChatOptions, testMode?: boolean): Promise<ChatResponse>;

    chat (prompt: string, options: StreamingChatOptions, testMode?: boolean): AsyncIterable<ChatResponseChunk>;
    chat (prompt: string, imageURL: string | File, options: StreamingChatOptions, testMode?: boolean): AsyncIterable<ChatResponseChunk>;
    chat (prompt: string, imageURLArray: string[], options: StreamingChatOptions, testMode?: boolean): AsyncIterable<ChatResponseChunk>;

    chat (messages: ChatMessage[], testMode?: boolean): Promise<ChatResponse>;
    chat (messages: ChatMessage[], options: ChatOptions, testMode?: boolean): Promise<ChatResponse>;
    chat (messages: ChatMessage[], options: StreamingChatOptions, testMode?: boolean): AsyncIterable<ChatResponseChunk>;

    img2txt (source: string | File | Blob, testMode?: boolean): Promise<string>;
    img2txt (source: string | File | Blob, options: Img2TxtOptions, testMode?: boolean): Promise<string>;
    img2txt (options: Img2TxtOptions, testMode?: boolean): Promise<string>;

    txt2img (prompt: string, testMode?: boolean): Promise<HTMLImageElement>;
    txt2img (prompt: string, options: Txt2ImgOptions): Promise<HTMLImageElement>;
    txt2img (options: Txt2ImgOptions, testMode?: boolean): Promise<HTMLImageElement>;

    txt2vid (prompt: string, testMode?: boolean): Promise<HTMLVideoElement>;
    txt2vid (prompt: string, options: Txt2VidOptions): Promise<HTMLVideoElement>;
    txt2vid (options: Txt2VidOptions, testMode?: boolean): Promise<HTMLVideoElement>;

    speech2txt (source: string | File | Blob, testMode?: boolean): Promise<string>;
    speech2txt (source: string | File | Blob, options: TextFormatSpeech2TxtOptions, testMode?: boolean): Promise<string>;
    speech2txt (source: string | File | Blob, options: Speech2TxtOptions, testMode?: boolean): Promise<Speech2TxtResult>;
    speech2txt (options: TextFormatSpeech2TxtOptions, testMode?: boolean): Promise<string>;
    speech2txt (options: Speech2TxtOptions, testMode?: boolean): Promise<Speech2TxtResult>;

    speech2speech (source: string | File | Blob, testMode?: boolean): Promise<HTMLAudioElement>;
    speech2speech (source: string | File | Blob, options: Speech2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;
    speech2speech (options: Speech2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;

    txt2speech (text: string, testMode?: boolean): Promise<HTMLAudioElement>;
    txt2speech (text: string, options: Txt2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;
    txt2speech (text: string, language: string, testMode?: boolean): Promise<HTMLAudioElement>;
    txt2speech (text: string, language: string, voice: string, testMode?: boolean): Promise<HTMLAudioElement>;
    txt2speech (text: string, language: string, voice: string, engine: string, testMode?: boolean): Promise<HTMLAudioElement>;
}

// NOTE: AI responses contain provider-specific payloads that are not fully typed here because
// the SDK does not yet publish stable shapes for those fields.
