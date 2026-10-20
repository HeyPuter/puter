---
title: puter.ai.txt2vid()
description: Generate short video clips from text or reference images, or edit a video you supply, with Wan, Seedance, Veo, Kling, Gemini Omni and other models through Puter.js.
platforms: [websites, apps, nodejs, workers]
---

Given a prompt, generate a short video clip using AI. Puter routes the request to one of four upstream providers (Together AI, BytePlus Seedance, Google Gemini, Kling) based on the model you pick, waits for the clip to render, and resolves with a ready-to-play video. Every model can also start from an image you supply (image-to-video), and the same option names work across providers. Gemini Omni, FLUX 3 and the Kling Omni models can also edit a video you supply.

## Syntax

```js
puter.ai.txt2vid(prompt, testMode = false)
puter.ai.txt2vid(prompt, options = {})
puter.ai.txt2vid({prompt, ...options})
```

## Parameters

#### `prompt` (String) (required)

A non-empty string describing the video. Missing, blank, or non-string prompts reject with `prompt_required`. Describe the subject, the motion, the camera move and the mood; cues such as "slow motion", "aerial shot" or "handheld" are understood by most models.

#### `testMode` (Boolean) (optional)

When `true`, the call returns a short sample clip hosted by Puter instead of contacting a provider, so you can build your UI without spending credits. Defaults to `false`.

Test mode still resolves the `model` you asked for and still validates (and writes to) `puter_output_path`, so it catches misspelled model ids and permission problems before you go live.

#### `options` (Object) (optional)

Additional settings for the generation request.

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `String` | Text description for the video generation |
| `model` | `String` | Video model to use. Defaults to `'togetherai:wan-ai/wan2.7-t2v'` (Wan 2.7 text-to-video). See [Choosing a model](#choosing-a-model) |
| `provider` | `String` | Pin the request to one provider: `'together-video-generation'`, `'byteplus-video-generation'`, `'gemini-video-generation'` or `'kling-video-generation'`. Only needed when a model id exists on more than one provider |
| `seconds` | `Number` | Target clip length in seconds. Each model supports a fixed set of durations; an unsupported value falls back to the model default instead of failing. Gemini Omni has no length control and rejects this option. `duration` is an alias |
| `size` | `String` | Output size as `'WIDTHxHEIGHT'` (e.g. `'1280x720'`) on every provider. Models that work in resolution tiers take the tier of the shorter side plus the aspect ratio, and also accept the tier directly (`'720p'`). An unsupported value falls back to the model default, except on Gemini Omni, which rejects it. `resolution` is an alias |
| `width`, `height` | `Number` | Output size in pixels on Together AI models sized in pixels; the aspect ratio on Seedance, Kling and Wan 2.7. Filled in from `size` when you leave them out |
| `input_reference` | `String \| Blob` | Image the clip starts from (image-to-video), on every provider. See [Image inputs](#image-inputs) for the formats it takes |
| `last_frame` | `String \| Blob` | Image the clip ends on, same formats. Requires `input_reference` on Seedance |
| `reference_images` | `Array<String \| Blob>` | Images the model keeps consistent as subjects or style, same formats. Limits per provider are listed below; not combined with `input_reference` or `last_frame`, except on Kling |
| `inputVideo` | `String \| Blob` | Video to edit, with the prompt describing the change. Only Gemini Omni, FLUX 3, Kling 3.0 Omni and Kling O1 accept it. See [Video input](#video-input) |
| `negative_prompt` | `String` | Text describing what to avoid in the video (Together AI) |
| `seed` | `Number` | Random seed for reproducible results (Together AI and Seedance 1.x) |
| `generate_audio` | `Boolean` | Generate a soundtrack, on models that support audio (Seedance, Kling and Together AI models with audio) |
| `test_mode` | `Boolean` | When `true`, returns a sample video without using credits |
| `puter_output_path` | `String` | When set, the generated video is automatically saved to this path on the Puter filesystem. Relative paths are resolved against the app's data directory (or `~/` outside an app). The caller must have write permission to the destination |

#### Choosing a model

Model ids are matched case-insensitively, and every model answers to a few spellings: the fully qualified id, the `org/model` form and the bare model name. `'togetherai:wan-ai/wan2.7-t2v'`, `'wan-ai/wan2.7-t2v'` and `'wan2.7-t2v'` all select the same model. When a bare name is served by more than one provider Puter picks the cheaper listing; pass `provider` or the fully qualified id to choose explicitly.

When you pass no model, Puter uses Wan 2.7 text-to-video on Together AI (`wan2.7-t2v`).

Google's Veo 3.1 preview models (`veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`, `veo-3.1-lite-generate-preview`) are no longer offered: Google deprecated them with a shutdown on October 22, 2026, and requests for those ids fail with `Model not found`. Veo 3.1 and Veo 3.1 Lite remain available through Together AI (see below).

On Together AI and Seedance, `seconds` and `size` are normalized rather than rejected: a value the model does not offer is replaced by the model default, which is the first value listed in the tables below and also what you get when you leave the option out. Gemini Omni rejects a value it doesn't offer with `bad_request` instead (see [Gemini Omni options](#gemini-omni-options)).

#### Image inputs

`input_reference`, `last_frame` and `reference_images` take the same formats everywhere:

- a public image URL
- a `data:` URI, or raw base64 (treated as PNG)
- the path of a PNG, JPEG, WebP or GIF file in the user's Puter filesystem
- a `Blob` or `File`

Providers that need inline bytes fetch URLs server-side, so a URL works on every model. Puter reads a Puter file with the caller's access, so a file the caller can't read fails with `access_denied` before generating. The Puter files one request names can be up to 32 MiB together.

puter.js uploads a `Blob`, a `File` or a `data:` URI over 1 MiB to a temporary file and sends its path instead of the bytes. The file goes in `~/AppData/<appID>/.tmp/` when called from an app, or `~/.tmp/` otherwise, and counts against the user's storage until puter.js deletes it after the call, whether the call succeeds or fails. When an image can't be uploaded, for example because the user's storage is full, puter.js sends it inline instead. A video that can't be uploaded fails the call with the upload's error.

What each provider does with image inputs:

| Provider | First frame | Last frame | Reference images |
|----------|-------------|------------|------------------|
| Together AI | Models with a `first` keyframe | Models with a `last` keyframe | Model-dependent (Seedance 2.5: up to 30) |
| BytePlus Seedance | Yes | Yes, with `input_reference` | Seedance 2.0: up to 9; Seedance 2.5: up to 30; cannot be combined with frames |
| Google Gemini | Yes, one PNG, JPEG or WebP image up to 5 MiB | No | No |
| Kling | Yes, JPEG or PNG | Yes, with `input_reference`, on the models listed in [Kling options](#kling-options) | Kling 3.0 Omni and O1: up to 7, or 4 with `inputVideo` |

#### Video input

Four models can change a video you supply: Gemini Omni (`gemini-omni-1.1-flash`), FLUX 3 on Together AI (`black-forest-labs/flux-3`), and Kling 3.0 Omni (`kling-3.0-omni`) and Kling O1 (`kling-o1`). Pass the video as `inputVideo` and describe the change in the prompt, such as "Make this dog a dinosaur". The result is a new clip that keeps the scene and motion of your video.

```js
const video = await puter.ai.txt2vid("Make this dog a dinosaur", {
    model: "gemini-omni-1.1-flash",
    inputVideo: "~/Videos/dog.mp4"
});
```

The video can be a public URL, the path of a file in the user's Puter filesystem, a `Blob` or `File`, or a `data:` URI. Puter accepts a `data:` URI of up to 1 MiB, and puter.js uploads a `Blob`, a `File` or a larger `data:` URI to a temporary file, as described in [Image inputs](#image-inputs). Puter checks the size and format of a `data:` URI or Puter file before generating. Kling doesn't take a `data:` URI. The models differ in what they take and return:

| | Gemini Omni | FLUX 3 | Kling 3.0 Omni and O1 |
|---|---|---|---|
| Formats | MP4, QuickTime or WebM | MP4, QuickTime, WebM or Matroska | MP4 or QuickTime |
| Size | Up to 32 MiB | Up to 32 MiB for a Puter file. A URL is fetched by Together AI | Up to 200 MiB for a Puter file. A URL is fetched by Kling |
| Source length | Up to 10 seconds. A longer video fails with `upstream_bad_request` and isn't charged | Any | 3 to 15 seconds on Kling 3.0 Omni, 3 to 10 seconds on Kling O1 |
| Output length | The model decides. The prompt can also ask it to continue the clip past its end | `seconds`, from 5 to 20. Defaults to 6 | The length of the source. `seconds` is ignored |
| Output size | `size`, see [Gemini Omni options](#gemini-omni-options) | 1280x704 | `size`, see [Kling options](#kling-options) |
| Price | Per token, see [Gemini Omni options](#gemini-omni-options) | $0.43 per second of output | Per second of output, see [Kling options](#kling-options) |

FLUX 3 and Kling get a Puter file as a link that works for 15 minutes, which the provider fetches when the job starts.

Every other model rejects `inputVideo` with `bad_request`. These models reject it together with frame images (`input_reference` and `last_frame`, and on FLUX 3 also `reference_images` and `frame_images`). Kling takes up to 4 `reference_images` with it.

#### Together AI options

Available when using any model below (provider `'together-video-generation'`). Pass the model as `'org/model'`, or prefix it with `togetherai:` to make the routing explicit.

Together AI models are priced in one of two ways, marked in the table:

- **Per clip.** The model renders a fixed-length clip for a flat price. The request is either affordable or rejected with `insufficient_funds`.
- **Per second.** Newer models are billed per second of output at a rate that depends on the resolution. Puter prices the request at the model's highest published rate, shortens the clip to fit the remaining balance (see [Cost and clip length](#cost-and-clip-length)), and charges that price for the finished clip.

Most models size their output in pixels: pass `size` as `'WIDTHxHEIGHT'` (or `width` and `height` directly) from the combinations each model advertises in the sizes column. Seedance 2.5 and Wan 2.7 instead work in resolution tiers, so `size` picks the tier of the shorter side (or name the tier directly), and Wan 2.7 takes the aspect ratio from it. "Keyframes" says whether the model can start from an image (`first`) and also end on one (`last`); supply them through `input_reference` and `last_frame`, or through `frame_images` for finer control. "Provider default" means Together AI has not published the values: the model applies its own defaults, and a `seconds` or size it does not accept is rejected with `upstream_bad_request`.

| Model | Pricing | Duration (s) | Sizes | FPS | Keyframes | Notes |
|-------|---------|--------------|-------|-----|-----------|-------|
| `minimax/video-01-director` | Per clip | 5 | `1366x768` | 25 | first | |
| `minimax/hailuo-02` | Per clip | 10 | `1366x768`, `1920x1080` | 25 | first | |
| `google/veo-3.1` | Per second | `4`, `6`, `8` | provider default | 24 | first, last | Soundtrack always generated |
| `google/veo-3.1-lite` | Per second | `4`, `6`, `8` | provider default | 24 | first, last | Soundtrack always generated |
| `bytedance/seedance-1.0-lite` | Per clip | 5 | `864x480`, `736x544`, `640x640`, `960x416`, `416x960`, `1248x704`, `1120x832`, `960x960`, `1504x640`, `640x1504` | 24 | first, last | |
| `bytedance/seedance-1.0-pro` | Per clip | 5 | same as Seedance 1.0 Lite | 24 | first, last | |
| `bytedance/seedance-2.0` | Per second | 4 to 15, default 5 | provider default | 24 | first, last | Soundtrack generated by default |
| `bytedance/seedance-2.5` | Per second | 4 to 30, default 5 | `720p`, `480p` | 24 | first, last | Soundtrack always generated; up to 30 `reference_images`; no aspect ratio control |
| `pixverse/pixverse-v5` | Per clip | 5 | 360p, 540p, 720p or 1080p in 16:9, 4:3, 1:1, 3:4 or 9:16 (e.g. `1280x720`, `720x720`, `720x1280`) | 16, 24 | first, last | |
| `pixverse/pixverse-v5.6` | Per second | provider default | provider default | | | |
| `pixverse/pixverse-v6` | Per second | provider default | provider default | | | |
| `wan-ai/wan2.7-t2v` (default) | Per second | 2 to 15, default 5 | `720P`, `1080P` in 16:9, 9:16, 1:1, 4:3 or 3:4 | 30 | | Soundtrack generated |
| `wan-ai/wan2.7-i2v` | Per second | 2 to 15, default 5 | as Wan 2.7 T2V | 30 | first, last | Image-to-video: requires a first frame |
| `wan-ai/wan2.7-r2v` | Per second | 2 to 10, default 5 | as Wan 2.7 T2V | 30 | | Reference-to-video: requires `reference_images` |
| `alibaba/happyhorse-1.0-t2v` | Per second | provider default | provider default | | | |
| `alibaba/happyhorse-1.0-i2v` | Per second | provider default | provider default | | first | Image-to-video: requires a first frame |
| `alibaba/happyhorse-1.0-r2v` | Per second | provider default | provider default | | | Reference-to-video: requires `reference_images` |
| `alibaba/happyhorse-1.1-t2v` | Per second | provider default | provider default | | | |
| `alibaba/happyhorse-1.1-i2v` | Per second | provider default | provider default | | first | Image-to-video: requires a first frame |
| `alibaba/happyhorse-1.1-r2v` | Per second | provider default | provider default | | | Reference-to-video: requires `reference_images` |
| `vidu/vidu-q1` | Per clip | 5 | `1920x1080`, `1080x1080`, `1080x1920` | 24 | first, last | |
| `vidu/vidu-q3` | Per second | provider default | provider default | | | |
| `vidu/vidu-q3-turbo` | Per second | provider default | provider default | | | |
| `black-forest-labs/flux-3` | Per second | provider default | provider default | | | Edits a video passed as `inputVideo`, see [Video input](#video-input) |

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above |
| `size` | `String` | `'WIDTHxHEIGHT'` from the sizes column, or a tier (`'720p'`, `'480p'`, `'720P'`, `'1080P'`) for Seedance 2.5 and Wan 2.7. `resolution` is an alias |
| `width` | `Number` | Output video width in pixels. On Wan 2.7, `width` and `height` only select the aspect ratio |
| `height` | `Number` | Output video height in pixels |
| `fps` | `Number` | Frames per second, where the model offers a choice |
| `steps` | `Number` | Number of inference steps |
| `guidance_scale` | `Number` | How closely to follow the prompt |
| `seed` | `Number` | Random seed for reproducible results |
| `output_format` | `String` | Output format for the video |
| `output_quality` | `Number` | Quality level of the output |
| `negative_prompt` | `String` | Text describing what to avoid in the video |
| `generate_audio` | `Boolean` | Generate a soundtrack, on models that support audio |
| `input_reference` | `String \| Blob` | First-frame image, in any [image input](#image-inputs) format. Sent as the model's first keyframe |
| `last_frame` | `String \| Blob` | Last-frame image, same formats. Sent as the model's last keyframe |
| `reference_images` | `Array<String \| Blob>` | Reference images to guide the generation |
| `frame_images` | `Array<Object>` | Explicit keyframes, overriding `input_reference` and `last_frame`. Each object has `input_image` (`String` or `Blob`) and `frame` (`Number`, the frame position the image anchors; `0` is the first frame). One image is the first frame; two are the first and last |
| `metadata` | `Object` | Additional metadata for the request |

For more details about each option, see the [Together AI API reference](https://docs.together.ai/reference/create-videos).

#### BytePlus (Seedance) options

Available when using a Seedance model served by BytePlus ModelArk (provider `'byteplus-video-generation'`). These models take any whole number of seconds within their range and work in resolution tiers: pass `size` as a tier or as `'WIDTHxHEIGHT'`, which selects the tier of the shorter side and the aspect ratio.

| Model | Alias | Duration (s) | Resolutions | Audio | Last frame | Reference images | Seed |
|-------|-------|--------------|-------------|-------|------------|------------------|------|
| `dreamina-seedance-2-5-260628` | `seedance-2-5` | 4 to 30, default 5 | `720p`, `480p`, `1080p` | Yes | Yes | Up to 30 | No |
| `dreamina-seedance-2-0-260128` | `seedance-2-0` | 4 to 15, default 5 | `720p`, `480p`, `1080p`, `4k` | Yes | Yes | Up to 9 | No |
| `dreamina-seedance-2-0-fast-260128` | `seedance-2-0-fast` | 4 to 15, default 5 | `720p`, `480p` | Yes | Yes | Up to 9 | No |
| `dreamina-seedance-2-0-mini-260615` (default) | `seedance-2-0-mini` | 4 to 15, default 5 | `720p`, `480p` | Yes | Yes | Up to 9 | No |
| `seedance-1-0-pro-250528` | `seedance-1-0-pro` | 2 to 12, default 5 | `1080p`, `480p`, `720p` | No | Yes | No | Yes |
| `seedance-1-0-pro-fast-251015` | `seedance-1-0-pro-fast` | 2 to 12, default 5 | `1080p`, `480p`, `720p` | No | No | No | Yes |

The first resolution listed is the default. Seedance is billed per video token, and the token count grows with duration and pixel count, so a 4K clip costs several times more per second than 720p. Generated clips carry no watermark.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above (full id or alias) |
| `seconds` | `Number` | Clip length, any whole number of seconds in the model's range. Out-of-range values fall back to `5` |
| `size` | `String` | Resolution tier: `'480p'`, `'720p'`, `'1080p'` or `'4k'` (case-insensitive) from the table above, or `'WIDTHxHEIGHT'`. `resolution` is an alias |
| `width`, `height` | `Number` | Optional. Only their ratio is used, to pick the output aspect ratio: `16:9`, `4:3`, `1:1`, `3:4`, `9:16` or `21:9`. Any other ratio is ignored and the model chooses |
| `generate_audio` | `Boolean` | Generate a soundtrack along with the video. Defaults to `true` on models that support audio. Set `false` for a silent clip, which on Seedance 1.5 Pro is also cheaper |
| `seed` | `Number` | Random seed for reproducible results. Seedance 1.x only |
| `input_reference` | `String \| Blob` | Image used as the first frame (image-to-video), in any [image input](#image-inputs) format |
| `last_frame` | `String \| Blob` | Image used as the last frame, same formats. Requires `input_reference` |
| `reference_images` | `Array<String \| Blob>` | Images the model uses as subject or style references, same formats. Up to 9 on the Seedance 2.0 models, up to 30 on Seedance 2.5. Cannot be combined with `input_reference` or `last_frame` |

An invalid combination (a last frame without a first frame, reference images together with a first frame, or an option the model lacks) is rejected with `bad_request` before any credits are spent.

For more details, see the [BytePlus ModelArk video generation reference](https://docs.byteplus.com/en/docs/ModelArk/1520757).

#### Gemini Omni options

Available when using `gemini-omni-1.1-flash` (provider `'gemini-video-generation'`), which also answers to `google/gemini-omni-1.1-flash`. It's offered when the Puter deployment has Gemini configured. It generates a clip from a prompt, from a prompt and one starting image, or from a prompt and a video to edit. The model picks the clip length and renders at 24 frames per second.

| `size` | 16:9 (default) | 9:16 |
|--------|----------------|------|
| `'360p'` | `640x360` | `360x640` |
| `'720p'` (default) | `1280x720` | `720x1280` |
| `'1080p'` | `1920x1080` | `1080x1920` |
| `'4k'` | `3840x2160` | `2160x3840` |

Google produces 1080p and 4K by upscaling. Pass the resolution on its own for 16:9, or the exact size for either orientation.

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `String` | Up to 4,000 characters |
| `size` | `String` | A resolution or exact size from the table above, case-insensitive. Defaults to `'720p'` at 16:9. `resolution` is an alias, and must match `size` when you pass both |
| `width`, `height` | `Number` | Together, an exact size from the table above. They must match `size` when you pass it |
| `input_reference` | `String \| Blob` | The image the clip starts from, in any [image input](#image-inputs) format. PNG, JPEG or WebP, up to 5 MiB |
| `inputVideo` | `String \| Blob` | The video to edit or extend, in any format [Video input](#video-input) lists. MP4, QuickTime or WebM, up to 32 MiB and 10 seconds |
| `output_format` | `String` | Only `'video/mp4'` |

Gemini Omni rejects `seconds`, `duration`, `fps`, `steps`, `guidance_scale`, `seed`, `negative_prompt`, `output_quality`, `generate_audio`, `frame_images`, `last_frame`, `reference_images` and `metadata` with `bad_request`, test mode included, since it has no matching control.

Gemini Omni is priced per token. Input costs $1.50 per million tokens. Video output costs $17.50 per million tokens. Other output and the model's thinking cost $9 per million tokens. The prompt and image or video together are limited to 131,072 input tokens. A source video costs about 1,500 input tokens per second, so a 10-second video adds about $0.02. Other limits are listed in [Rate limits and quotas](/rate-limits-and-quotas/#video-generation).

```html;ai-txt2vid-gemini
<script src="https://js.puter.com/v2/"></script>
<script>
    puter.ai.txt2vid("A stationary red ball on a white table.", {
        model: "gemini-omni-1.1-flash",
        size: "360p"
    }).then(video => document.body.appendChild(video)).catch(console.error);
</script>
```

#### Kling options

Available when using a Kling model (provider `'kling-video-generation'`). Every model also answers to `kling/<model>` and to Kling's own model name, listed as the alias. Kling models take any whole number of seconds in their range and work in resolution tiers: pass `size` as a tier, or as `'WIDTHxHEIGHT'`, which selects the tier of the shorter side and the aspect ratio. They render at 24 frames per second.

| Model | Alias | Duration (s) | Resolutions | Audio | Last frame | Reference images | `inputVideo` |
|-------|-------|--------------|-------------|-------|------------|------------------|--------------|
| `kling-3.0-turbo` (default) | `kling-v3-turbo` | 3 to 15, default 5 | `720p`, `1080p` | Always | No | No | No |
| `kling-3.0` | `kling-v3` | 3 to 15, default 5 | `720p`, `1080p`, `4k` | Optional | Yes | No | No |
| `kling-3.0-omni` | `kling-v3-omni` | 3 to 15, default 5 | `720p`, `1080p`, `4k` | Optional | Yes | Up to 7 | Yes |
| `kling-o1` | `kling-video-o1` | 3 to 10, default 5. 5 or 10 with only `input_reference` | `720p`, `1080p` | No | Yes | Up to 7 | Yes |
| `kling-2.6` | `kling-v2-6` | 5 or 10 | `720p`, `1080p` | Optional, at `1080p` only | At `1080p`, without audio | No | No |
| `kling-2.5-turbo` | `kling-v2-5-turbo` | 5 or 10 | `720p`, `1080p` | No | At `1080p` | No | No |

The first resolution listed is the default. Prices are per second of output:

| Model | 720p | 1080p | 4K |
|-------|------|-------|----|
| `kling-3.0-turbo` | $0.112 | $0.14 | |
| `kling-3.0` | $0.084, $0.126 with audio | $0.112, $0.168 with audio | $0.42 |
| `kling-3.0-omni` | $0.084, $0.112 with audio, $0.126 with `inputVideo` | $0.112, $0.14 with audio, $0.168 with `inputVideo` | $0.42 |
| `kling-o1` | $0.084, $0.126 with `inputVideo` | $0.112, $0.168 with `inputVideo` | |
| `kling-2.6` | $0.042 | $0.07, $0.14 with audio | |
| `kling-2.5-turbo` | $0.042 | $0.07 | |

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above (full id or alias) |
| `prompt` | `String` | Up to 3,072 characters on the Kling 3.0 models, 2,500 on the others |
| `seconds` | `Number` | Clip length, from the table above. Any other value falls back to `5`. Ignored with `inputVideo` |
| `size` | `String` | Resolution tier: `'720p'`, `'1080p'` or `'4k'` (case-insensitive), or `'WIDTHxHEIGHT'`. `resolution` is an alias |
| `width`, `height` | `Number` | Optional. Only their ratio is used, to pick the aspect ratio: `16:9`, `9:16` or `1:1`. Any other ratio gives `16:9`. A clip from `input_reference` or `inputVideo` takes the image's or video's shape |
| `generate_audio` | `Boolean` | Generate a soundtrack on models with optional audio. Defaults to `false`. With `inputVideo`, the clip keeps the source video's sound unless this is `false` |
| `input_reference` | `String \| Blob` | Image used as the first frame, in any [image input](#image-inputs) format. JPEG or PNG, at least 300 pixels per side |
| `last_frame` | `String \| Blob` | Image used as the last frame, same formats. Requires `input_reference` |
| `reference_images` | `Array<String \| Blob>` | Images the model uses as subject, style or scene references, same formats |
| `inputVideo` | `String \| Blob` | Video to edit, described by the prompt. See [Video input](#video-input) |

An option the model lacks, or a combination it doesn't support, is rejected with `bad_request` before any credits are spent. Clips carry no watermark. Kling returns a hosted URL that stays available for 30 days.

For more details, see the [Kling video API reference](https://kling.ai/document-api/api/video/3-0-omni/text-to-video).

Any properties not set fall back to provider defaults.

#### Saving to Puter filesystem

Pass `puter_output_path` to persist the generated video directly on the Puter filesystem. Relative paths are resolved against `~/AppData/<appID>/` when called from an app, or `~/` otherwise:

```js
puter.ai.txt2vid("A drone shot over a forest", {
    puter_output_path: "videos/forest.mp4"  // saved to ~/AppData/<appID>/videos/forest.mp4
});
```

Absolute paths (`/username/Videos/forest.mp4`) and home-relative paths (`~/Videos/forest.mp4`) are sent as-is. Write permission to the destination is enforced server-side.

The destination is checked before generation starts, so a path you cannot write to fails immediately with `access_denied` and costs nothing. Missing parent folders are created and an existing file at the path is overwritten. Most providers return a temporary hosted URL (see [Return value](#return-value)), so this is the way to keep a clip after the request completes.

#### Cost and clip length

Every successful generation is charged to the user's AI credits according to the model, duration and resolution. Before contacting the provider, Puter compares the estimated cost with the remaining balance:

- **Seedance** is priced per second. If the balance cannot cover the requested length, Puter shortens the clip to the longest duration the model supports that the balance does cover, and rejects with `insufficient_funds` only when even the shortest clip is unaffordable. The response does not flag a shortened clip, so read `video.duration` once metadata has loaded if the exact length matters.
- **Together AI** prices its older models per clip, so those requests are either accepted at the model's duration or rejected with `insufficient_funds`. Its per-second models (marked in the Together AI table), including the default Wan 2.7, are shortened like Seedance, and charged at the model's highest published rate per second.
- **Kling** is priced per second, and clips are shortened like Seedance. An edit of an `inputVideo` is as long as its source, so Puter holds the price of the longest source the model accepts (15 seconds on Kling 3.0 Omni, 10 on Kling O1) and charges for the length of the clip Kling returns.
- **Gemini Omni** is priced per token and has no length control, so it's never shortened. Before generating, Puter counts the input tokens and holds an estimate of about $3.63 plus the input. The estimate covers 173,760 video tokens and 65,536 text and thinking tokens. Puter doesn't count the tokens of an `inputVideo`, so a request with one holds another 16,000 input tokens, about $0.02, which covers a 10-second video. Puter reads the video only after the estimate is held. A balance that can't cover it fails with `insufficient_funds` before generation starts. The charge is for the tokens Google reports for the clip. It can be higher than the estimate, because Google can go past the requested output limit. When Google's reply reports token usage but fails or has no usable clip, those tokens are charged and the request still fails.

Apart from that Gemini Omni case, a request that fails or times out is not charged. The request and concurrency limits that apply to every AI call are listed in [Rate limits and quotas](/rate-limits-and-quotas/).

#### How long it takes

Video generation is slow: expect anywhere from tens of seconds to several minutes, growing with duration and resolution. The returned promise stays pending until the clip is ready, so keep the UI responsive with a progress indicator (see the examples below). Puter waits up to ten minutes for a job; one that outlives the window fails with `upstream_timeout`.

## Return value

A `Promise` that resolves to an `HTMLVideoElement` (in browsers) that you can append to the DOM straight away:

- `src` is the clip's URL: an `https:` URL on the provider's storage (Together AI or Seedance), or a `data:video/mp4;base64,…` URI holding the whole clip (Gemini Omni). Provider URLs are temporary; keep a copy with `puter_output_path` if you need the clip later.
- `controls` is enabled and `preload` is `"metadata"`.
- The `data-source` attribute carries the same URL, and `data-mime-type` the MIME type when it is known (for example `video/mp4`).
- `String(video)` returns the URL, so the element can be dropped into a template or passed to `fetch()`.

In Node.js and Workers, where there is no DOM, the promise resolves to a plain object with the same `src`, `controls` and `preload` fields and the same `toString()`; the `data-*` attributes are not present. Use `fetch(video.src)` to read the bytes, or `puter_output_path` to have Puter store the file for you.

In test mode `src` is always the `https:` URL of Puter's sample clip.

> **Note:** Each successful generation consumes the user's AI credits in accordance with the model, duration and resolution you request. See [Cost and clip length](#cost-and-clip-length) for how Puter fits a clip to the remaining balance.

## Errors

A rejection carries the error body exactly as the backend sent it, or `{ message, code }` for the checks the SDK runs before making the request. Every error has `message` and `code`; the other fields appear when they apply.

| Field | Meaning |
| --- | --- |
| `message` | Human-readable reason. `error` carries the same text for older clients. |
| `code` | Stable error code; see the table below. |
| `errorCode` | A more specific code alongside a general `code`. Today the only value is `moderation_flagged`. |
| `provider` | Which upstream handled the request: `together`, `byteplus` or `gemini`. Present on errors raised while a job was running. |
| `upstreamCode` | The provider's own error code, when it gave one. |
| `upstreamStatus` | The HTTP status the provider returned, when it rejected the request before a job started. |

| Code | Meaning |
| --- | --- |
| `prompt_required` | Raised by the SDK before any request is made: the call had no prompt. |
| `bad_request` (without `errorCode`) | Puter rejected the request before contacting a provider: an unknown `model` (`Model not found: …`), an invalid combination of image inputs, an option Gemini Omni doesn't support, `inputVideo` on a model that can't take it, an image or video URL that could not be fetched, or a Puter file that isn't an accepted image or video format. `message` says which. Arrives as HTTP 400. |
| `input_too_large` | An image or video input is over its size limit. The limits are 5 MiB for an image on Gemini Omni, 32 MiB for a video, 1 MiB for a video sent as a `data:` URI, and 32 MiB for the Puter file images of one request together. Arrives as HTTP 413, before any credits are spent. |
| `access_denied` | `puter_output_path` points somewhere the caller may not write, or an image or video input names a Puter file the caller may not read. Arrives as HTTP 403, before any credits are spent. `cannot_write_to_root` (HTTP 400) is the same check for a path directly under `/`. |
| `upstream_timeout` | The provider did not finish the clip within the ten minutes Puter waits for it, or stopped answering. Arrives as HTTP 504. The request itself was fine; retry it, ideally with a shorter clip or a faster model. |
| `errorCode: moderation_flagged` | The provider's content filter refused the prompt or removed the generated video. Arrives as HTTP 400, with `code: bad_request`. Change the prompt rather than retrying it as-is. |
| `upstream_bad_request` | The provider rejected the request itself, for example a duration the model does not support. Arrives as HTTP 400; `message` and `upstreamCode` carry the provider's reason. |
| `upstream_failed` | The provider accepted the request but generation failed on their side. Arrives as HTTP 502 and is safe to retry. |
| `insufficient_funds` | Your balance cannot cover even the shortest clip the model offers (or, for a per-clip Together AI model, the clip). Arrives as HTTP 402; `message` states the shortfall. |

Other `upstream_*` codes mean the provider rejected the request or was unavailable before a job started; `message` carries the provider's reason.

## Examples

<strong class="example-title">Generate a sample clip (test mode)</strong>

```html;ai-txt2vid
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid(
            "A sunrise drone shot flying over a calm ocean",
            true // test mode avoids using credits
        ).then((video) => {
            document.body.appendChild(video);
        }).catch(console.error);
    </script>
</body>
</html>
```

<strong class="example-title">Generate an 8-second cinematic clip in 1080p</strong>

```html;ai-txt2vid-options
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid("A fox sprinting through a snow-covered forest at dusk", {
            model: "wan2.7-t2v",
            seconds: 8,
            size: "1920x1080"
        }).then((video) => {
            document.body.appendChild(video);
            // Autoplay once metadata is available
            video.addEventListener('loadeddata', () => video.play().catch(() => {}));
        }).catch(console.error);
    </script>
</body>
</html>
```

<strong class="example-title">Use Google Veo through Together AI with a negative prompt</strong>

```html;ai-txt2vid-veo
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid("A hummingbird hovering over a red flower, macro lens, soft morning light", {
            model: "togetherai:google/veo-3.1-lite",
            seconds: 6,
            negative_prompt: "blurry, text, watermark, people"
        }).then((video) => {
            document.body.appendChild(video);
        }).catch(console.error);
    </script>
</body>
</html>
```

<strong class="example-title">Animate a photo (image-to-video)</strong>

```html;ai-txt2vid-image-to-video
<html>
<body>
    <p>Pick a photo to animate:</p>
    <input type="file" id="photo" accept="image/*">
    <p id="status"></p>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        const status = document.getElementById('status');

        document.getElementById('photo').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            // Seedance takes the first frame as a data: URI
            const dataUri = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            status.textContent = 'Generating... this can take a few minutes.';
            try {
                const video = await puter.ai.txt2vid("Slow push-in on the scene as a gentle wind moves through it", {
                    model: "seedance-2-0-mini",
                    seconds: 5,
                    size: "720p",
                    input_reference: dataUri,
                    generate_audio: false
                });
                status.textContent = '';
                document.body.appendChild(video);
            } catch (err) {
                status.textContent = `Failed: ${err.message} (${err.code})`;
            }
        });
    </script>
</body>
</html>
```

<strong class="example-title">Save the clip to the Puter filesystem</strong>

```html;ai-txt2vid-save
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // test_mode keeps this free; the sample clip is still written to the path
        puter.ai.txt2vid({
            prompt: "A paper boat drifting down a rain-soaked street",
            test_mode: true,
            puter_output_path: "videos/paper-boat.mp4"  // ~/AppData/<appID>/videos/paper-boat.mp4
        }).then(async (video) => {
            const file = await puter.fs.stat("videos/paper-boat.mp4");
            puter.print(`Saved ${file.name} (${file.size} bytes) to ${file.path}`);
            document.body.appendChild(video);
        }).catch(console.error);
    </script>
</body>
</html>
```

<strong class="example-title">Show progress and handle errors</strong>

```html;ai-txt2vid-errors
<html>
<body>
    <button id="go">Generate</button>
    <p id="status"></p>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        const status = document.getElementById('status');

        document.getElementById('go').addEventListener('click', async () => {
            const started = Date.now();
            const ticker = setInterval(() => {
                status.textContent = `Generating... ${Math.round((Date.now() - started) / 1000)}s`;
            }, 1000);

            try {
                // No model given: the default Wan 2.7 T2V is used
                const video = await puter.ai.txt2vid("A lighthouse in a storm, waves crashing, dramatic lighting", {
                    seconds: 4
                });
                status.textContent = 'Done';
                document.body.appendChild(video);
            } catch (err) {
                if (err.errorCode === 'moderation_flagged') {
                    status.textContent = 'The content filter refused this prompt. Try rewording it.';
                } else if (err.code === 'insufficient_funds') {
                    status.textContent = 'Not enough credits for this clip.';
                } else if (err.code === 'upstream_timeout') {
                    status.textContent = 'The provider took too long. Try again with a shorter clip.';
                } else {
                    status.textContent = `Failed: ${err.message} (${err.code})`;
                }
            } finally {
                clearInterval(ticker);
            }
        });
    </script>
</body>
</html>
```

<strong class="example-title">Generate a clip from Node.js</strong>

```js
import { init } from "@heyputer/puter.js/src/init.cjs";
const puter = init(process.env.puterAuthToken);

const video = await puter.ai.txt2vid("Time-lapse of clouds rolling over a mountain lake", {
    seconds: 6,
    puter_output_path: "~/Videos/clouds.mp4",
});

// There is no <video> element outside a browser; the result still exposes the URL.
console.log(String(video));
// The clip is also saved at ~/Videos/clouds.mp4 in the user's Puter filesystem.
```
