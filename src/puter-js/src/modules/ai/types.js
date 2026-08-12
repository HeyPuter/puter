// Shapes shared across the `puter.ai` operations. JSDoc-only; no runtime exports.
//
// Provider-specific response bodies stay loosely typed: the SDK does not yet
// publish stable shapes for those payloads.

/**
 * @typedef {string
 *     | { image_url?: { url: string } }
 *     | { video_url?: { url: string } }
 *     | Record<string, unknown>} AIMessageContent
 */

/**
 * An image attached to a message.
 *
 * @typedef {Object} ImageContent
 * @property {string} type
 * @property {{ url: string }} image_url
 */

/**
 * One tool call the model asked for.
 *
 * @typedef {Object} ToolCall
 * @property {string} id
 * @property {{ name: string, arguments: string }} function
 */

/**
 * A function/tool definition the model may call.
 *
 * @typedef {Object} Tool
 * @property {string} type
 * @property {{ name: string, description: string, parameters: object, strict?: boolean }} function
 */

/**
 * One message in a chat conversation.
 *
 * @typedef {Object} ChatMessage
 * @property {string} [role]
 * @property {AIMessageContent | AIMessageContent[]} content
 * @property {ToolCall[]} [tool_calls]
 * @property {string} [tool_call_id]
 * @property {{ type: string }} [cache_control]
 * @property {ImageContent[]} [images] Images attached to the message. Present on responses from
 * image-capable models.
 */

/**
 * Options for a chat completion request.
 *
 * @typedef {Object} ChatOptions
 * @property {string} [model] The model to use for the completion. Defaults to `gpt-5-nano` if not
 * specified.
 * @property {number} [temperature] Sampling temperature between 0 and 2. Lower values are more focused
 * and deterministic, higher values more random. Defaults to the model's own default.
 * @property {number} [max_tokens]
 * @property {boolean} [vision]
 * @property {string} [driver]
 * @property {string} [provider] The provider to route the request through.
 * @property {Tool[]} [tools] Function/tool definitions the model can call. See Function Calling.
 * @property {unknown} [response]
 * @property {string} [reasoning_effort] Controls how much effort reasoning models spend thinking. Flat
 * form. Accepted values: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` (availability varies by
 * model; default `medium` on newer GPT-5.x models). Reasoning models only.
 * @property {{ effort: string }} [reasoning] Nested form of `reasoning_effort`. The `effort` value
 * accepts the same values as `reasoning_effort`. Reasoning models only.
 * @property {string} [verbosity] Controls how long or short responses are. Flat form. Accepted values:
 * `low`, `medium`, `high`. Reasoning models only.
 * @property {{ verbosity: string }} [text] Nested form of `verbosity` — it lives under `text`. The
 * `verbosity` value accepts the same values as `verbosity`. Reasoning models only.
 * @property {{ aspect_ratio: string, image_size: string }} [image_config] Controls image output for
 * image-capable models. `aspect_ratio` is the aspect ratio of the generated image, e.g. `"16:9"`,
 * `"1:1"`, `"9:16"`; `image_size` is the output quality/resolution and must be one of the model's
 * supported quality levels.
 * @property {boolean | { trigger_tokens?: number }} [compaction] Provider-neutral inline-compaction
 * opt-in for long stateless conversations. `true` enables it with provider defaults; an object sets the
 * token threshold at which earlier context is summarized. When the upstream compacts, you receive a
 * `"compaction"` chunk (streaming) or a `compaction` field on the result (non-streaming) — resend it in
 * `messages` on the next turn in place of the summarized history.
 * @property {unknown} [context_management] Escape hatch: a provider-native `context_management`
 * payload, passed through untouched. Prefer `compaction` for provider portability.
 */

/**
 * `ChatOptions` with streaming turned on, which changes what `chat()` resolves
 * to.
 *
 * @typedef {ChatOptions & { stream: boolean }} StreamingChatOptions
 */

/**
 * What a non-streaming `chat()` resolves to.
 *
 * @typedef {Object} ChatResponse
 * @property {ChatMessage} [message]
 * @property {unknown} [choices]
 * @property {{ type: 'compaction', id?: string, encrypted_content: string }} [compaction]
 * Inline-compaction artifact, present when the upstream compacted earlier context during this
 * (non-streaming) response. Carries `type:'compaction'` so you can push it straight into `messages` on
 * the next turn in place of the summarized history (same shape as the streaming `compaction` chunk).
 */

/**
 * A single chunk of a streaming chat response. Each chunk has a `type`
 * discriminator; which other fields are present depends on that `type`.
 *
 * @typedef {Object} ChatResponseChunk
 * @property {string} type The kind of chunk: `"text"`, `"reasoning"`, `"image"`, `"tool_use"`,
 * `"compaction"`, `"extra_content"`, `"usage"`, or `"error"`.
 * @property {string} [text] Text delta. Present on `"text"` chunks.
 * @property {string} [reasoning] Reasoning/thinking delta. Present on `"reasoning"` chunks.
 * @property {ImageContent} [image] A generated image. Present on `"image"` chunks from image-capable
 * models.
 * @property {string} [id] Tool call id (`"tool_use"`) or compaction item id (`"compaction"`).
 * @property {string} [name] Tool/function name. Present on `"tool_use"` chunks.
 * @property {unknown} [input] Parsed tool call arguments. Present on `"tool_use"` chunks.
 * @property {string} [encrypted_content] Opaque/encrypted compaction summary. Present on
 * `"compaction"` chunks — the same shape regardless of which provider served the request. Resend it in
 * `messages` on the next turn in place of the summarized history.
 * @property {unknown} [extra_content] Provider-specific extra metadata.
 * @property {Record<string, number>} [usage] Token usage totals. Present on the final `"usage"` chunk.
 * @property {string} [message] Error description. Present on `"error"` chunks, which end the stream.
 */

/**
 * Options for `img2txt()` (OCR).
 *
 * @typedef {Object} Img2TxtOptions
 * @property {string | File | Blob} [source]
 * @property {string} [provider]
 * @property {boolean} [testMode]
 * @property {boolean} [test_mode] `snake_case` spelling of `testMode`, forwarded to the driver as-is.
 * @property {string} [model]
 * @property {number[]} [pages]
 * @property {boolean} [includeImageBase64]
 * @property {number} [imageLimit]
 * @property {number} [imageMinSize]
 * @property {string} [bboxAnnotationFormat]
 * @property {string} [documentAnnotationFormat]
 */

/**
 * Options for `txt2img()`.
 *
 * @typedef {Object} Txt2ImgOptions
 * @property {string} [prompt] Text description of the image to generate.
 * @property {string} [model] Image model to use (provider-specific). Defaults to `'gpt-image-1-mini'`
 * (OpenAI), or `'grok-imagine-image'` when `provider` is `'xai'`.
 * @property {string} [quality] Image quality / output size tier. Interpretation is provider- and
 * model-specific: OpenAI GPT models take `'high'` | `'medium'` | `'low'` (default `'low'`), and
 * `gpt-image-2` also accepts `'auto'`; Gemini takes an output size tier `'512'` | `'1K'` | `'2K'` |
 * `'4K'` (availability varies by model).
 * @property {string} [input_image] An input image for image-to-image generation. Replicate and xAI
 * `grok-imagine-*` accept a URL; Gemini and OpenAI `gpt-image-*` expect a base64-encoded (or data-URI)
 * image (xAI also accepts base64/data-URI).
 * @property {string[]} [input_images] Multiple input images for image-to-image / multi-image
 * generation. Gemini and OpenAI `gpt-image-*` expect base64-encoded (or data-URI) images; Replicate
 * expects image URLs; xAI `grok-imagine-*` accepts either (up to 3 images).
 * @property {string} [input_image_mime_type] MIME type of the input image(s), e.g. `'image/png'`. Used
 * as a fallback when the type cannot be auto-detected (Gemini).
 * @property {string} [driver]
 * @property {string} [provider]
 * @property {string} [service]
 * @property {{ w: number, h: number }} [ratio] Aspect ratio as `{ w, h }` (e.g. `{ w: 16, h: 9 }`).
 * Supported by OpenAI, Gemini, and Replicate.
 * @property {number} [width] Width of the image to generate, in pixels (Together). Default `1024`.
 * @property {number} [height] Height of the image to generate, in pixels (Together). Default `1024`.
 * @property {string} [aspect_ratio] Alternative way to specify the aspect ratio (Together).
 * @property {number} [steps] Number of generation/inference steps (Together, default `20`; Replicate
 * `flux-schnell`).
 * @property {number} [seed] Seed used for generation; reuse to reproduce results (Together, Replicate).
 * @property {string} [negative_prompt] Prompt describing what NOT to guide the image generation toward
 * (Together).
 * @property {number} [n] Number of image results to generate (Together). Default `1`.
 * @property {string} [image_url] URL of an input image for models that support it (Together).
 * @property {string} [image_base64] Base64-encoded input image for image-to-image generation (Together).
 * @property {string} [mask_image_url] URL of a mask image for inpainting (Together).
 * @property {string} [mask_image_base64] Base64-encoded mask image for inpainting (Together).
 * @property {number} [prompt_strength] How strongly the prompt influences the output (Together).
 * @property {boolean} [disable_safety_checker] When `true`, disables the safety checker (Together,
 * Replicate).
 * @property {string} [response_format] Format of the image response. Together: `'base64'` | `'url'`.
 * Replicate: output format, e.g. `'webp'` | `'jpg'` | `'png'`.
 * @property {number} [guidance] Guidance scale (Replicate `flux-2-klein-9b-base`).
 * @property {boolean} [go_fast] Use the model's optimized fast mode (Replicate `flux-2-dev`). Defaults
 * to `true` for that model, and affects pricing.
 * @property {number} [output_quality] Output quality, 0-100 (Replicate, flux family).
 * @property {string} [output_megapixels] Approximate output size in megapixels (Replicate, flux
 * family), e.g. `'0.25'` | `'0.5'` | `'1'` | `'2'`.
 * @property {number} [safety_tolerance] Safety tolerance level (Replicate `flux-2-pro`,
 * `flux-1.1-pro`).
 * @property {boolean} [prompt_upsampling] Enable prompt upsampling (Replicate `flux-1.1-pro`).
 * @property {string} [generation_mode] Generation tier for Replicate Leonardo models, which affects
 * pricing: `'standard'` | `'ultra'` (`lucid-origin`), `'fast'` | `'quality'` | `'ultra'`
 * (`phoenix-1.0`).
 * @property {string} [style] Stylistic preset (Replicate Leonardo models).
 * @property {string} [contrast] Contrast preset (Replicate Leonardo models).
 * @property {boolean} [prompt_enhance] Server-side prompt enhancement (Replicate Leonardo models).
 * @property {boolean} [test_mode] When `true`, returns a sample image without using credits.
 * @property {string} [puter_output_path] When set, the generated image is saved to this path on the
 * Puter filesystem. Relative paths resolve against the app's data directory (`~/AppData/<appID>/`) when
 * called from an app, or `~/` otherwise. The caller must have write permission to the destination.
 */

/**
 * Options for `txt2vid()`.
 *
 * @typedef {Object} Txt2VidOptions
 * @property {string} [prompt]
 * @property {string} [driver]
 * @property {string} [model]
 * @property {number} [seconds]
 * @property {number} [duration]
 * @property {boolean} [test_mode]
 * @property {string} [size] OpenAI: output size.
 * @property {string} [resolution] OpenAI: output resolution.
 * @property {File | string} [input_reference] OpenAI: reference clip or image.
 * @property {number} [width] TogetherAI.
 * @property {number} [height] TogetherAI.
 * @property {number} [fps] TogetherAI.
 * @property {number} [steps] TogetherAI.
 * @property {number} [guidance_scale] TogetherAI.
 * @property {number} [seed] TogetherAI.
 * @property {string} [output_format] TogetherAI.
 * @property {number} [output_quality] TogetherAI.
 * @property {string} [negative_prompt] TogetherAI.
 * @property {string[]} [reference_images] TogetherAI.
 * @property {Array<{ input_image: string, frame: number }>} [frame_images] TogetherAI.
 * @property {Record<string, unknown>} [metadata] TogetherAI.
 * @property {string} [puter_output_path] Save the generated video to this path on the Puter filesystem.
 * @property {string} [last_frame] Final frame to guide generation toward.
 */

/**
 * Options for `txt2speech()`.
 *
 * @typedef {Object} Txt2SpeechOptions
 * @property {string} [text] Text to synthesize. Must be less than 3000 characters.
 * @property {string} [language] Language code. For AWS Polly defaults to `'en-US'`; for xAI a BCP-47
 * code defaulting to `'en'` (supports `'auto'`).
 * @property {string} [voice] Voice ID used for synthesis (provider-specific). Defaults to `'Joanna'`
 * (aws-polly), `'alloy'` (openai), `'21m00Tcm4TlvDq8ikWAM'` (elevenlabs), `'Kore'` (gemini), `'eve'`
 * (xai), `'geffen_32'` (speechify).
 * @property {string} [engine] AWS Polly synthesis engine: `'standard'` (default), `'neural'`,
 * `'long-form'`, or `'generative'`.
 * @property {string} [provider] TTS provider: `'aws-polly'` (default), `'openai'`, `'elevenlabs'`,
 * `'gemini'`, `'xai'`, or `'speechify'`. Common aliases (`'eleven'`, `'google'`, `'grok'`, `'polly'`,
 * `'simba'`, …) resolve to these.
 * @property {string} [model] Model identifier (provider-specific).
 * @property {string} [response_format] OpenAI output format: `'mp3'` (default), `'wav'`, `'opus'`,
 * `'aac'`, `'flac'`, or `'pcm'`.
 * @property {string} [output_format] Output format for ElevenLabs (defaults to `'mp3_44100_128'`) and
 * xAI (`'mp3'` default, `'wav'`, `'pcm'`, `'mulaw'`, `'alaw'`).
 * @property {string} [instructions] Natural-language guidance for voice style such as tone, speed, and
 * mood (OpenAI and Gemini).
 * @property {Record<string, unknown>} [voice_settings] ElevenLabs voice tuning options (e.g. stability,
 * similarity boost, speed).
 * @property {boolean} [ssml] When `true`, AWS Polly treats `text` as SSML markup.
 * @property {boolean} [test_mode] When `true`, returns a sample audio without using credits.
 */

/**
 * Options for `txt2speech.listEngines()`.
 *
 * @typedef {Object} ListTTSEnginesOptions
 * @property {string} [provider] TTS provider to query. Defaults to `'aws-polly'`; `'all'` returns every
 * provider's engines.
 */

/**
 * A TTS engine/model as returned by `txt2speech.listEngines()`.
 *
 * @typedef {Object} TTSEngine
 * @property {string} id Engine/model identifier.
 * @property {string} name Human-readable engine name.
 * @property {string} provider Provider this engine belongs to.
 * @property {number} [pricing_per_million_chars] Cost per million characters (may be absent).
 */

/**
 * Options for `txt2speech.listVoices()`.
 *
 * @typedef {Object} ListTTSVoicesOptions
 * @property {string} [provider] TTS provider to query. Defaults to `'aws-polly'`; `'all'` returns every
 * provider's voices.
 * @property {string} [engine] Engine/model filter (provider-specific, ignored by some providers).
 */

/**
 * A TTS voice as returned by `txt2speech.listVoices()`.
 *
 * @typedef {Object} TTSVoice
 * @property {string} id Voice identifier to pass to `txt2speech()`.
 * @property {string} name Human-readable voice name.
 * @property {string} provider Provider this voice belongs to.
 * @property {{ name: string, code: string }} [language] Language info (may be absent).
 * @property {string} [description] Short description of the voice (may be absent).
 * @property {string} [category] Voice category, e.g. `'premade'` (may be absent).
 * @property {Record<string, unknown>} [labels] Provider-specific labels (may be absent).
 * @property {string[]} [supported_models] Model IDs this voice works with (may be absent).
 * @property {string[]} [supported_engines] Engine types this voice supports (may be absent).
 */

/**
 * One word of a `speech2txt()` transcript.
 *
 * @typedef {Object} Speech2TxtWord
 * @property {string} text
 * @property {number} start
 * @property {number} end
 * @property {string} [speaker] Detected speaker, present when `diarize: true` (xAI).
 */

/**
 * What `speech2txt()` resolves to, unless `response_format` is `"text"`.
 *
 * @typedef {Object} Speech2TxtResult
 * @property {string} text
 * @property {string} language
 * @property {Record<string, unknown>[]} [segments]
 * @property {number} [duration] Duration of the audio in seconds (provider-dependent, e.g. xAI).
 * @property {Speech2TxtWord[]} [words] Per-word timestamps (provider-dependent, e.g. xAI).
 */

/**
 * The options every `speech2txt()` form shares.
 *
 * @typedef {Object} BaseSpeech2TxtOptions
 * @property {string | File | Blob} [file]
 * @property {string | File | Blob} [audio]
 * @property {string} [provider]
 * @property {string} [model]
 * @property {string} [language]
 * @property {string} [prompt]
 * @property {boolean} [stream]
 * @property {boolean} [translate]
 * @property {number} [temperature]
 * @property {boolean} [logprobs]
 * @property {string[]} [timestamp_granularities]
 * @property {string} [chunking_strategy]
 * @property {string[]} [known_speaker_names]
 * @property {string[]} [known_speaker_references]
 * @property {Record<string, unknown>} [extra_body]
 * @property {boolean} [format]
 * @property {boolean} [diarize]
 * @property {boolean} [multichannel]
 * @property {number} [channels]
 * @property {string} [audio_format]
 * @property {number} [sample_rate]
 * @property {boolean} [test_mode]
 */

/**
 * The `response_format: "text"` form, which resolves to a plain string.
 *
 * @typedef {BaseSpeech2TxtOptions & { response_format: 'text' }} TextFormatSpeech2TxtOptions
 */

/**
 * Any other `speech2txt()` form, which resolves to a `Speech2TxtResult`.
 *
 * @typedef {BaseSpeech2TxtOptions & { response_format?: Exclude<string, 'text'> }} Speech2TxtOptions
 */

/**
 * Options for `speech2speech()`. The camelCase aliases are mapped onto the
 * snake_case names before the request goes out; the snake_case spelling wins
 * when both are given.
 *
 * @typedef {Object} Speech2SpeechOptions
 * @property {string | File | Blob} [audio]
 * @property {string | File | Blob} [file]
 * @property {string} [provider]
 * @property {string} [model]
 * @property {string} [model_id]
 * @property {string} [voice]
 * @property {string} [voice_id]
 * @property {string} [output_format]
 * @property {Record<string, unknown>} [voice_settings]
 * @property {number} [seed]
 * @property {string} [file_format]
 * @property {boolean} [remove_background_noise]
 * @property {number} [optimize_streaming_latency]
 * @property {boolean} [enable_logging]
 * @property {boolean} [test_mode]
 * @property {string} [modelId] camelCase alias of `model_id`.
 * @property {string} [voiceId] camelCase alias of `voice_id`.
 * @property {string} [outputFormat] camelCase alias of `output_format`.
 * @property {Record<string, unknown>} [voiceSettings] camelCase alias of `voice_settings`.
 * @property {string} [fileFormat] camelCase alias of `file_format`.
 * @property {boolean} [removeBackgroundNoise] camelCase alias of `remove_background_noise`.
 * @property {number} [optimizeStreamingLatency] camelCase alias of `optimize_streaming_latency`.
 * @property {boolean} [enableLogging] camelCase alias of `enable_logging`.
 */

export {};
