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
    /** Text description of the image to generate. */
    prompt?: string;
    /**
     * Image model to use (provider-specific). Defaults to `'gpt-image-1-mini'`
     * (OpenAI), or `'grok-2-image'` when `provider` is `'xai'`.
     */
    model?: string;
    /**
     * Image quality / output size tier. Interpretation is provider- and
     * model-specific:
     * - OpenAI GPT models: `'high'` | `'medium'` | `'low'` (default `'low'`);
     *   `gpt-image-2` also accepts `'auto'`.
     * - OpenAI DALL-E 3: `'hd'` | `'standard'` (default `'standard'`).
     * - Gemini: output size tier `'512'` | `'1K'` | `'2K'` | `'4K'`
     *   (availability varies by model).
     */
    quality?: string;
    /**
     * An input image for image-to-image generation. Replicate expects a URL;
     * Gemini expects a base64-encoded image.
     */
    input_image?: string;
    /**
     * Multiple input images for image-to-image / multi-image generation.
     * Gemini expects base64-encoded images; Replicate expects image URLs.
     */
    input_images?: string[];
    /**
     * MIME type of the input image(s), e.g. `'image/png'`. Used as a fallback
     * when the type cannot be auto-detected (Gemini).
     */
    input_image_mime_type?: string;
    driver?: string;
    provider?: string;
    service?: string;
    /**
     * Aspect ratio as `{ w, h }` (e.g. `{ w: 16, h: 9 }`). Supported by OpenAI,
     * Gemini, and Replicate.
     */
    ratio?: { w: number; h: number };
    /** Width of the image to generate, in pixels (Together). Default `1024`. */
    width?: number;
    /** Height of the image to generate, in pixels (Together). Default `1024`. */
    height?: number;
    /** Alternative way to specify the aspect ratio (Together). */
    aspect_ratio?: string;
    /**
     * Number of generation/inference steps (Together, default `20`; Replicate
     * `flux-schnell`).
     */
    steps?: number;
    /** Seed used for generation; reuse to reproduce results (Together, Replicate). */
    seed?: number;
    /** Prompt describing what NOT to guide the image generation toward (Together). */
    negative_prompt?: string;
    /** Number of image results to generate (Together). Default `1`. */
    n?: number;
    /** URL of an input image for models that support it (Together). */
    image_url?: string;
    /** Base64-encoded input image for image-to-image generation (Together). */
    image_base64?: string;
    /** URL of a mask image for inpainting (Together). */
    mask_image_url?: string;
    /** Base64-encoded mask image for inpainting (Together). */
    mask_image_base64?: string;
    /** How strongly the prompt influences the output (Together). */
    prompt_strength?: number;
    /** When `true`, disables the safety checker (Together, Replicate). */
    disable_safety_checker?: boolean;
    /**
     * Format of the image response. Together: `'base64'` | `'url'`. Replicate:
     * output format, e.g. `'webp'` | `'jpg'` | `'png'`.
     */
    response_format?: string;
    /** When `true`, returns a sample image without using credits. */
    test_mode?: boolean;
    /**
     * When set, the generated image is saved to this path on the Puter
     * filesystem. Relative paths resolve against the app's data directory
     * (`~/AppData/<appID>/`) when called from an app, or `~/` otherwise. The
     * caller must have write permission to the destination.
     */
    puter_output_path?: string;
}

export interface Txt2VidOptions {
    prompt?: string;
    driver?: string;
    model?: string;
    seconds?: number;
    duration?: number;
    test_mode?: boolean;

    // OpenAI options
    size?: string;
    resolution?: string;
    input_reference?: File | string;

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

    last_frame?: string;
}

export interface Txt2SpeechOptions {
    /** Text to synthesize. Must be less than 3000 characters. */
    text?: string;
    /** Language code. For AWS Polly defaults to `'en-US'`; for xAI a BCP-47 code defaulting to `'en'` (supports `'auto'`). */
    language?: string;
    /** Voice ID used for synthesis (provider-specific). Defaults to `'Joanna'` (aws-polly), `'alloy'` (openai), `'21m00Tcm4TlvDq8ikWAM'` (elevenlabs), `'Kore'` (gemini), `'eve'` (xai). */
    voice?: string;
    /** AWS Polly synthesis engine: `'standard'` (default), `'neural'`, `'long-form'`, or `'generative'`. */
    engine?: string;
    /** TTS provider: `'aws-polly'` (default), `'openai'`, `'elevenlabs'`, `'gemini'`, or `'xai'`. */
    provider?: string;
    /** Model identifier (provider-specific). */
    model?: string;
    /** OpenAI output format: `'mp3'` (default), `'wav'`, `'opus'`, `'aac'`, `'flac'`, or `'pcm'`. */
    response_format?: string;
    /** Output format for ElevenLabs (defaults to `'mp3_44100_128'`) and xAI (`'mp3'` default, `'wav'`, `'pcm'`, `'mulaw'`, `'alaw'`). */
    output_format?: string;
    /** Natural-language guidance for voice style such as tone, speed, and mood (OpenAI and Gemini). */
    instructions?: string;
    /** ElevenLabs voice tuning options (e.g. stability, similarity boost, speed). */
    voice_settings?: Record<string, unknown>;
    /** When `true`, AWS Polly treats `text` as SSML markup. */
    ssml?: boolean;
    /** When `true`, returns a sample audio without using credits. */
    test_mode?: boolean;
}

export interface ListTTSEnginesOptions {
    /** TTS provider to query. Defaults to `'aws-polly'`. */
    provider?: string;
}

/** A TTS engine/model as returned by `txt2speech.listEngines()`. */
export interface TTSEngine {
    /** Engine/model identifier. */
    id: string;
    /** Human-readable engine name. */
    name: string;
    /** Provider this engine belongs to. */
    provider: string;
    /** Cost per million characters (may be absent). */
    pricing_per_million_chars?: number;
}

export interface ListTTSVoicesOptions {
    /** TTS provider to query. Defaults to `'aws-polly'`. */
    provider?: string;
    /** Engine/model filter (provider-specific, ignored by some providers). */
    engine?: string;
}

/** A TTS voice as returned by `txt2speech.listVoices()`. */
export interface TTSVoice {
    /** Voice identifier to pass to `txt2speech()`. */
    id: string;
    /** Human-readable voice name. */
    name: string;
    /** Provider this voice belongs to. */
    provider: string;
    /** Language info (may be absent). */
    language?: { name: string; code: string };
    /** Short description of the voice (may be absent). */
    description?: string;
    /** Voice category, e.g. `'premade'` (may be absent). */
    category?: string;
    /** Provider-specific labels (may be absent). */
    labels?: Record<string, unknown>;
    /** Model IDs this voice works with (may be absent). */
    supported_models?: string[];
    /** Engine types this voice supports (may be absent). */
    supported_engines?: string[];
}

/**
 * Converts text to speech. Callable directly, with `listEngines` and
 * `listVoices` helpers attached for discovering available engines and voices.
 */
export interface Txt2Speech {
    (text: string, testMode?: boolean): Promise<HTMLAudioElement>;
    (text: string, options: Txt2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;
    (text: string, language: string, testMode?: boolean): Promise<HTMLAudioElement>;
    (text: string, language: string, voice: string, testMode?: boolean): Promise<HTMLAudioElement>;
    (text: string, language: string, voice: string, engine: string, testMode?: boolean): Promise<HTMLAudioElement>;

    /** List available TTS engines/models with pricing information. */
    listEngines (provider?: string): Promise<TTSEngine[]>;
    listEngines (options?: ListTTSEnginesOptions): Promise<TTSEngine[]>;

    /** List available TTS voices, optionally filtered by provider/engine. */
    listVoices (engine?: string): Promise<TTSVoice[]>;
    listVoices (options?: ListTTSVoicesOptions): Promise<TTSVoice[]>;
}

export interface Speech2TxtWord {
    text: string;
    start: number;
    end: number;
    /** Detected speaker, present when `diarize: true` (xAI). */
    speaker?: string;
}

export interface Speech2TxtResult {
    text: string;
    language: string;
    segments?: Record<string, unknown>[];
    /** Duration of the audio in seconds (provider-dependent, e.g. xAI). */
    duration?: number;
    /** Per-word timestamps (provider-dependent, e.g. xAI). */
    words?: Speech2TxtWord[];
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

    speech2txt (source: string | File | Blob, testMode?: boolean): Promise<Speech2TxtResult>;
    speech2txt (source: string | File | Blob, options: TextFormatSpeech2TxtOptions, testMode?: boolean): Promise<string>;
    speech2txt (source: string | File | Blob, options: Speech2TxtOptions, testMode?: boolean): Promise<Speech2TxtResult>;
    speech2txt (options: TextFormatSpeech2TxtOptions, testMode?: boolean): Promise<string>;
    speech2txt (options: Speech2TxtOptions, testMode?: boolean): Promise<Speech2TxtResult>;

    speech2speech (source: string | File | Blob, testMode?: boolean): Promise<HTMLAudioElement>;
    speech2speech (source: string | File | Blob, options: Speech2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;
    speech2speech (options: Speech2SpeechOptions, testMode?: boolean): Promise<HTMLAudioElement>;

    txt2speech: Txt2Speech;
}

// NOTE: AI responses contain provider-specific payloads that are not fully typed here because
// the SDK does not yet publish stable shapes for those fields.
