export type AIMessageContent = string | { image_url?: { url: string } } | { video_url?: { url: string } } | Record<string, unknown>;

export interface ImageContent {
    type: string;
    image_url: { url: string };
}

export interface ChatMessage {
    role?: string;
    content: AIMessageContent | AIMessageContent[];
    tool_calls?: ToolCall[];
    tool_call_id?: string;
    cache_control?: { type: string };
    images: ImageContent[];
}

export interface ToolCall {
    id: string;
    function: { name: string, arguments: string };
}

export interface Tool {
    type: string;
    function: { name: string, description: string, parameters: object, strict?: boolean };
}

/**
 * Options for a chat completion request.
 */
export interface ChatOptions {
    /** The model to use for the completion. Defaults to `gpt-5-nano` if not specified. */
    model?: string;
    /** Sampling temperature between 0 and 2. Lower values are more focused and deterministic, higher values more random. Defaults to the model's own default. */
    temperature?: number;
    max_tokens?: number;
    vision?: boolean;
    driver?: string;
    /** The provider to route the request through. */
    provider?: string;
    /** Function/tool definitions the model can call. See Function Calling. */
    tools?: Tool[];
    response?: unknown;
    /**
     * Controls how much effort reasoning models spend thinking. Flat form.
     * Accepted values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh`
     * (availability varies by model; default `medium` on newer GPT-5.x models).
     * Reasoning models only.
     */
    reasoning_effort?: string;
    /**
     * Nested form of `reasoning_effort`. The `effort` value accepts the same
     * values as `reasoning_effort`. Reasoning models only.
     */
    reasoning?: { effort: string};
    /**
     * Controls how long or short responses are. Flat form. Accepted values:
     * `low`, `medium`, `high`. Reasoning models only.
     */
    verbosity?: string;
    /**
     * Nested form of `verbosity` — it lives under `text`. The `verbosity` value
     * accepts the same values as `verbosity`. Reasoning models only.
     */
    text?: { verbosity: string};
    /**
     * Controls image output for image-capable models.
     * - `aspect_ratio`: aspect ratio of the generated image, e.g. `"16:9"`, `"1:1"`, `"9:16"`.
     * - `image_size`: output quality/resolution; must be one of the model's supported quality levels.
     */
    image_config?: { aspect_ratio: string, image_size: string };
}

export interface StreamingChatOptions extends ChatOptions {
    stream: boolean;
}

export interface ChatResponse {
    message?: ChatMessage;
    choices?: unknown;
}

/**
 * A single chunk of a streaming chat response. Each chunk has a `type`
 * discriminator; which other fields are present depends on that `type`.
 */
export interface ChatResponseChunk {
    /** The kind of chunk: `"text"`, `"reasoning"`, `"tool_use"`, `"extra_content"`, or `"usage"`. */
    type: string;
    /** Text delta. Present on `"text"` chunks. */
    text?: string;
    /** Reasoning/thinking delta. Present on `"reasoning"` chunks. */
    reasoning?: string;
    /** Tool call id. Present on `"tool_use"` chunks. */
    id?: string;
    /** Tool/function name. Present on `"tool_use"` chunks. */
    name?: string;
    /** Parsed tool call arguments. Present on `"tool_use"` chunks. */
    input?: unknown;
    /** Provider-specific extra metadata. */
    extra_content?: unknown;
    /** Token usage totals. Present on the final `"usage"` chunk. */
    usage?: Record<string, number>;
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
    puter_output_path?: string;
}

export interface Txt2VidOptions {
    prompt?: string;
    provider?: string;
    driver?: string;
    model?: string;
    seconds?: number;
    duration?: number;
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
    puter_output_path?: string;
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
    provider?: string;
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
    format?: boolean;
    diarize?: boolean;
    multichannel?: boolean;
    channels?: number;
    audio_format?: string;
    sample_rate?: number;
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
