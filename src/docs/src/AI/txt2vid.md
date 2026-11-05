---
title: puter.ai.txt2vid()
description: Generate short video clips from text or reference images, or edit a video you supply, with Wan, Seedance, Veo, Kling, MiniMax H3, Gemini Omni and other models through Puter.js.
platforms: [websites, apps, nodejs, workers]
---

Given a prompt, generate a short video clip using AI.

Puter routes the request to one of five upstream providers (Together AI, BytePlus Seedance, Google Gemini, Kling, MiniMax) based on the model you pick, waits for the clip to render, and resolves with a ready-to-play video. Every model can also start from an image you supply (image-to-video), and the same option names work across providers. Some models can also edit a video you supply.

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
| `model` | `String` | Video model to use. Defaults to `'togetherai:wan-ai/wan2.7-t2v'` (Wan 2.7 text-to-video). See [Model-specific features](#model-specific-features) for each provider's models |
| `seconds` | `Number` | Target clip length in seconds. Each model supports a fixed set of durations; an unsupported value falls back to the model default instead of failing. The `duration` option is an alias. See [Model-specific features](#model-specific-features) |
| `size` | `String` | Output size as `'WIDTHxHEIGHT'` (e.g. `'1280x720'`) on every provider. An unsupported value falls back to the model default. The `resolution` option is an alias. See [Model-specific features](#model-specific-features) |
| `width` | `Number` | Output width in pixels. Filled in from `size` when you leave it out. See [Model-specific features](#model-specific-features) |
| `height` | `Number` | Output height in pixels. Works the same way as `width` |
| `input_reference` | `String \| Blob` | Image the clip starts from (image-to-video), on every provider. See [Image inputs](#image-inputs) for the formats it takes |
| `last_frame` | `String \| Blob` | Image the clip ends on, same formats. See [Model-specific features](#model-specific-features) |
| `reference_images` | `Array<String \| Blob>` | Images the model keeps consistent as subjects or style, same formats. See [Model-specific features](#model-specific-features) |
| `inputVideo` | `String \| Blob` | Video to edit, with the prompt describing the change. Only Gemini Omni, FLUX 3, Kling 3.0 Omni and Kling O1 accept it. See [Video input](#video-input) |
| `generate_audio` | `Boolean` | Generate a soundtrack, on models that support audio (Seedance, Kling and Together AI models with audio) |
| `puter_output_path` | `String` | When set, the generated video is automatically saved to this path on the Puter filesystem. Relative paths are resolved against the app's data directory (or `~/` outside an app). The caller must have write permission to the destination |
| `provider` | `String` | Pin the request to one provider: `'together-video-generation'`, `'byteplus-video-generation'`, `'gemini-video-generation'`, `'kling-video-generation'` or `'minimax-video-generation'`. Only needed when a model id exists on more than one provider |
| `test_mode` | `Boolean` | When `true`, returns a sample video without using credits |

Some models accept additional options or handle these options differently. See [Model-specific features](#model-specific-features).

## Return value

A `Promise` that resolves to an `HTMLVideoElement` (in browsers) that you can append to the DOM straight away:

- The `src` property is the clip's URL: an `https:` URL on the provider's storage (Together AI, Seedance, Kling or MiniMax), or a `data:video/mp4;base64,…` URI holding the whole clip (Gemini Omni). Provider URLs are temporary; keep a copy with `puter_output_path` if you need the clip later.
- The `controls` property is enabled and `preload` is `"metadata"`.
- The `data-source` attribute carries the same URL, and `data-mime-type` the MIME type when it is known (for example `video/mp4`).
- Calling `String(video)` returns the URL, so the element can be dropped into a template or passed to `fetch()`.

In Node.js and Workers, where there is no DOM, the promise resolves to a plain object with the same `src`, `controls` and `preload` fields and the same `toString()`; the `data-*` attributes are not present. Use `fetch(video.src)` to read the bytes, or `puter_output_path` to have Puter store the file for you.

In test mode `src` is always the `https:` URL of Puter's sample clip.

> **Note:** Each successful generation consumes the user's AI credits in accordance with the model, duration and resolution you request. See [Cost and clip length](#cost-and-clip-length) for how Puter fits a clip to the remaining balance.

## Errors

A rejection carries the error body exactly as the backend sent it, or `{ message, code }` for the checks the SDK runs before making the request. Every error has `message` and `code`; the other fields appear when they apply.

| Field | Meaning |
| --- | --- |
| `message` | Human-readable reason. The `error` field carries the same text for older clients. |
| `code` | Stable error code; see the table below. |
| `errorCode` | A more specific code alongside a general `code`. Today the only value is `moderation_flagged`. |
| `provider` | Which upstream handled the request: `together`, `byteplus`, `gemini`, `kling` or `minimax`. Present on errors raised while a job was running. |
| `upstreamCode` | The provider's own error code, when it gave one. |
| `upstreamStatus` | The HTTP status the provider returned, when it rejected the request before a job started. |

| Code | Meaning |
| --- | --- |
| `prompt_required` | Raised by the SDK before any request is made: the call had no prompt. |
| `bad_request` (without `errorCode`) | Puter rejected the request before contacting a provider: an unknown `model` (`Model not found: …`), an invalid combination of image inputs, an option Gemini Omni doesn't support, `inputVideo` on a model that can't take it, an image or video URL that could not be fetched, or a Puter file that isn't an accepted image or video format. The `message` field says which. Arrives as HTTP 400. |
| `input_too_large` | An image or video input is over its size limit. The limits are 5 MiB for an image on Gemini Omni, 32 MiB for a video, 1 MiB for a video sent as a `data:` URI, and 32 MiB for the Puter file images of one request together. Arrives as HTTP 413, before any credits are spent. |
| `access_denied` | The `puter_output_path` option points somewhere the caller may not write, or an image or video input names a Puter file the caller may not read. Arrives as HTTP 403, before any credits are spent. The `cannot_write_to_root` code (HTTP 400) is the same check for a path directly under `/`. |
| `upstream_timeout` | The provider did not finish the clip within the 14 minutes Puter waits for it, or stopped answering. Arrives as HTTP 504. The request itself was fine; retry it, ideally with a shorter clip or a faster model. |
| `errorCode: moderation_flagged` | The provider's content filter refused the prompt or removed the generated video. Arrives as HTTP 400, with `code: bad_request`. Change the prompt rather than retrying it as-is. |
| `upstream_bad_request` | The provider rejected the request itself, for example a duration the model does not support. Arrives as HTTP 400; `message` and `upstreamCode` carry the provider's reason. |
| `upstream_failed` | The provider accepted the request but generation failed on their side. Arrives as HTTP 502 and is safe to retry. |
| `insufficient_funds` | Your balance cannot cover even the shortest clip the model offers (or, for a per-clip Together AI model, the clip). Arrives as HTTP 402; `message` states the shortfall. |

Other `upstream_*` codes mean the provider rejected the request or was unavailable before a job started; `message` carries the provider's reason.

## Image inputs

The `input_reference`, `last_frame` and `reference_images` options take the same formats everywhere:

- a public image URL
- a `data:` URI, or raw base64 (treated as PNG)
- the path of a PNG, JPEG, WebP or GIF file in the user's Puter filesystem
- a `Blob` or `File`

Providers that need inline bytes fetch URLs server-side, so a URL works on every model. Puter reads a Puter file with the caller's access, so a file the caller can't read fails with `access_denied` before generating. The Puter files one request names can be up to 32 MiB together.

puter.js uploads a `Blob`, a `File` or a `data:` URI over 1 MiB to a temporary file and sends its path instead of the bytes. The file goes in `~/AppData/<appID>/.tmp/` when called from an app, or `~/.tmp/` otherwise, and counts against the user's storage until puter.js deletes it after the call, whether the call succeeds or fails. When an image can't be uploaded, for example because the user's storage is full, puter.js sends it inline instead. A video that can't be uploaded fails the call with the upload's error.

## Video input

Four models can change a video you supply: Gemini Omni (`gemini-omni-1.1-flash`), FLUX 3 on Together AI (`black-forest-labs/flux-3`), and Kling 3.0 Omni (`kling-3.0-omni`) and Kling O1 (`kling-o1`). Pass the video as `inputVideo` and describe the change in the prompt, such as "Make this dog a dinosaur". The result is a new clip that keeps the scene and motion of your video.

```js
const video = await puter.ai.txt2vid("Make this dog a dinosaur", {
    model: "gemini-omni-1.1-flash",
    inputVideo: "~/Videos/dog.mp4"
});
```

The video can be a public URL, the path of a file in the user's Puter filesystem, a `Blob` or `File`, or a `data:` URI. Puter accepts a `data:` URI of up to 1 MiB, and puter.js uploads a `Blob`, a `File` or a larger `data:` URI to a temporary file, as described in [Image inputs](#image-inputs). Puter checks the size and format of a `data:` URI or Puter file before generating. The formats, sizes and lengths each model accepts are listed in its section under [Model-specific features](#model-specific-features).

Every other model rejects `inputVideo` with `bad_request`. These models reject it together with frame images (`input_reference` and `last_frame`).

## Saving to Puter filesystem

Pass `puter_output_path` to persist the generated video directly on the Puter filesystem. Relative paths are resolved against `~/AppData/<appID>/` when called from an app, or `~/` otherwise:

```js
puter.ai.txt2vid("A drone shot over a forest", {
    puter_output_path: "videos/forest.mp4"  // saved to ~/AppData/<appID>/videos/forest.mp4
});
```

Absolute paths (`/username/Videos/forest.mp4`) and home-relative paths (`~/Videos/forest.mp4`) are sent as-is. Write permission to the destination is enforced server-side.

The destination is checked before generation starts, so a path you cannot write to fails immediately with `access_denied` and costs nothing. Missing parent folders are created and an existing file at the path is overwritten. Most providers return a temporary hosted URL (see [Return value](#return-value)), so this is the way to keep a clip after the request completes.

## Cost and clip length

Every successful generation is charged to the user's AI credits according to the model, duration and resolution. Before contacting the provider, Puter compares the estimated cost with the remaining balance:

- A model priced per clip renders a fixed-length clip for a flat price, so the request is either accepted at that price or rejected with `insufficient_funds`.
- A model priced by the length of the clip is shortened to fit. If the balance cannot cover the requested length, Puter shortens the clip to the longest duration the model supports that the balance does cover, and rejects with `insufficient_funds` only when even the shortest clip is unaffordable. The response does not flag a shortened clip, so read `video.duration` once metadata has loaded if the exact length matters.

Each model's section under [Model-specific features](#model-specific-features) says how it's priced. A request that fails or times out is not charged, unless the model's section says otherwise. The request and concurrency limits that apply to every AI call are listed in [Rate limits and quotas](/rate-limits-and-quotas/).

## How long it takes

Video generation is slow: expect anywhere from tens of seconds to several minutes, growing with duration and resolution. The returned promise stays pending until the clip is ready, so keep the UI responsive with a progress indicator (see the examples below). Puter waits up to 14 minutes for a job; one that outlives the window fails with `upstream_timeout`.

## Model-specific features

### Together AI models

Available when using any model below (provider `'together-video-generation'`). Pass the model as `'org/model'`, or prefix it with `togetherai:` to make the routing explicit.

Together AI models are priced in one of two ways, marked in the table:

- **Per clip.** The model renders a fixed-length clip for a flat price. The request is either affordable or rejected with `insufficient_funds`.
- **Per second.** Newer models are billed per second of output at a rate that depends on the resolution. Puter prices the request at the model's highest published rate, shortens the clip to fit the remaining balance (see [Cost and clip length](#cost-and-clip-length)), and charges that price for the finished clip.

Most models size their output in pixels: pass `size` as `'WIDTHxHEIGHT'` (or `width` and `height` directly) from the combinations each model advertises in the sizes column. Seedance 2.5 and Wan 2.7 instead work in resolution tiers, so `size` picks the tier of the shorter side (or name the tier directly), and Wan 2.7 takes the aspect ratio from it. "Keyframes" says whether the model can start from an image (`first`) and also end on one (`last`); supply them through `input_reference` and `last_frame`, or through `frame_images` for finer control. "Provider default" means Together AI has not published the values: the model applies its own defaults, and a `seconds` or size it does not accept is rejected with `upstream_bad_request`.

For the other models, the first value listed in a column is the default, unless the row marks another value as the default. A `seconds` or `size` value the model doesn't offer is replaced by that default.

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
| `size` | `String` | Either `'WIDTHxHEIGHT'` from the sizes column, or a tier (`'720p'`, `'480p'`, `'720P'`, `'1080P'`) for Seedance 2.5 and Wan 2.7. The `resolution` option is an alias |
| `width` | `Number` | Output video width in pixels. On Wan 2.7, `width` and `height` only select the aspect ratio |
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
| `frame_images` | `Array<Object>` | Explicit keyframes, overriding `input_reference` and `last_frame`. Each object has `input_image` (`String` or `Blob`) and `frame` (`Number`, the frame position the image anchors; `0` is the first frame). One image is the first frame; two are the first and last |
| `metadata` | `Object` | Additional metadata for the request |

FLUX 3 (`black-forest-labs/flux-3`) edits a video passed as `inputVideo`. The video can be MP4, QuickTime, WebM or Matroska, of any length, and up to 32 MiB for a Puter file. Together AI fetches a URL itself, and gets a Puter file as a link that works for 19 minutes, which it fetches when the job starts. With `inputVideo`, the output is 1280x704, its length is set by `seconds` from 5 to 20 and defaults to 6, and it costs $0.43 per second of output. FLUX 3 also rejects `reference_images` and `frame_images` together with `inputVideo`.

For more details about each option, see the [Together AI API reference](https://docs.together.ai/reference/create-videos).

### BytePlus (Seedance) models

Available when using a Seedance model served by BytePlus ModelArk (provider `'byteplus-video-generation'`). These models take any whole number of seconds within their range and work in resolution tiers: pass `size` as a tier or as `'WIDTHxHEIGHT'`, which selects the tier of the shorter side and the aspect ratio.

| Model | Alias | Duration (s) | Resolutions | Audio | Last frame | Reference images | Seed |
|-------|-------|--------------|-------------|-------|------------|------------------|------|
| `dreamina-seedance-2-5-260628` | `seedance-2-5` | 4 to 30, default 5 | `720p`, `480p`, `1080p` | Yes | Yes | Up to 30 | No |
| `dreamina-seedance-2-0-260128` | `seedance-2-0` | 4 to 15, default 5 | `720p`, `480p`, `1080p`, `4k` | Yes | Yes | Up to 9 | No |
| `dreamina-seedance-2-0-fast-260128` | `seedance-2-0-fast` | 4 to 15, default 5 | `720p`, `480p` | Yes | Yes | Up to 9 | No |
| `dreamina-seedance-2-0-mini-260615` (default) | `seedance-2-0-mini` | 4 to 15, default 5 | `720p`, `480p` | Yes | Yes | Up to 9 | No |
| `seedance-1-0-pro-250528` | `seedance-1-0-pro` | 2 to 12, default 5 | `1080p`, `480p`, `720p` | No | Yes | No | Yes |
| `seedance-1-0-pro-fast-251015` | `seedance-1-0-pro-fast` | 2 to 12, default 5 | `1080p`, `480p`, `720p` | No | No | No | Yes |

The first resolution listed is the default. Seedance is billed per video token, and the token count grows with duration and pixel count, so a 4K clip costs several times more per second than 720p. Since the price grows with length, a clip is shortened to fit the balance, as described in [Cost and clip length](#cost-and-clip-length). Generated clips carry no watermark.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above (full id or alias) |
| `seconds` | `Number` | Clip length, any whole number of seconds in the model's range. Out-of-range values fall back to `5` |
| `size` | `String` | Resolution tier: `'480p'`, `'720p'`, `'1080p'` or `'4k'` (case-insensitive) from the table above, or `'WIDTHxHEIGHT'`. The `resolution` option is an alias |
| `width` | `Number` | Optional. Only the ratio of `width` to `height` is used, to pick the output aspect ratio: `16:9`, `4:3`, `1:1`, `3:4`, `9:16` or `21:9`. Any other ratio is ignored and the model chooses |
| `height` | `Number` | Works the same way as `width` |
| `generate_audio` | `Boolean` | Generate a soundtrack along with the video. Defaults to `true` on models that support audio. Set `false` for a silent clip, which on Seedance 1.5 Pro is also cheaper |
| `seed` | `Number` | Random seed for reproducible results. Seedance 1.x only |
| `last_frame` | `String \| Blob` | Image used as the last frame, same formats. Requires `input_reference` |
| `reference_images` | `Array<String \| Blob>` | Images the model uses as subject or style references, same formats. Up to 9 on the Seedance 2.0 models, up to 30 on Seedance 2.5. Cannot be combined with `input_reference` or `last_frame` |

An invalid combination (a last frame without a first frame, reference images together with a first frame, or an option the model lacks) is rejected with `bad_request` before any credits are spent.

For more details, see the [BytePlus ModelArk video generation reference](https://docs.byteplus.com/en/docs/ModelArk/1520757).

### Gemini Omni models

Available when using `gemini-omni-1.1-flash` (provider `'gemini-video-generation'`), which also answers to `google/gemini-omni-1.1-flash`. It generates a clip from a prompt, from a prompt and one starting image, or from a prompt and a video to edit. The model picks the clip length and renders at 24 frames per second. When editing an `inputVideo`, the prompt can also ask it to continue the clip past its end.

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
| `size` | `String` | A resolution or exact size from the table above, case-insensitive. Any other value is rejected with `bad_request`. Defaults to `'720p'` at 16:9. The `resolution` option is an alias, and must match `size` when you pass both |
| `width` | `Number` | Together with `height`, an exact size from the table above. Both must match `size` when you pass it |
| `height` | `Number` | Works the same way as `width` |
| `input_reference` | `String \| Blob` | The image the clip starts from, in any [image input](#image-inputs) format. PNG, JPEG or WebP, up to 5 MiB |
| `inputVideo` | `String \| Blob` | The video to edit or extend, in any format [Video input](#video-input) lists. MP4, QuickTime or WebM, up to 32 MiB and 10 seconds. A longer video fails with `upstream_bad_request` and isn't charged |
| `output_format` | `String` | Only `'video/mp4'` |

Gemini Omni rejects `seconds`, `duration`, `fps`, `steps`, `guidance_scale`, `seed`, `negative_prompt`, `output_quality`, `generate_audio`, `frame_images`, `last_frame`, `reference_images` and `metadata` with `bad_request`, test mode included, since it has no matching control.

Gemini Omni is priced per token. Input costs $1.50 per million tokens. Video output costs $17.50 per million tokens. Other output and the model's thinking cost $9 per million tokens. The prompt and image or video together are limited to 131,072 input tokens. A source video costs about 1,500 input tokens per second, so a 10-second video adds about $0.02. Other limits are listed in [Rate limits and quotas](/rate-limits-and-quotas/#video-generation).

Gemini Omni has no length control, so it's never shortened. Before generating, Puter counts the input tokens and holds an estimate of about $3.63 plus the input. The estimate covers 173,760 video tokens and 65,536 text and thinking tokens. Puter doesn't count the tokens of an `inputVideo`, so a request with one holds another 16,000 input tokens, about $0.02, which covers a 10-second video. Puter reads the video only after the estimate is held. A balance that can't cover it fails with `insufficient_funds` before generation starts. The charge is for the tokens Google reports for the clip. It can be higher than the estimate, because Google can go past the requested output limit. When Google's reply reports token usage but fails or has no usable clip, those tokens are charged and the request still fails.

```html;ai-txt2vid-gemini
<script src="https://js.puter.com/v2/"></script>
<script>
    puter.ai.txt2vid("A stationary red ball on a white table.", {
        model: "gemini-omni-1.1-flash",
        size: "360p"
    }).then(video => document.body.appendChild(video)).catch(console.error);
</script>
```

### Kling models

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

A clip is shortened to fit the balance, as described in [Cost and clip length](#cost-and-clip-length). An edit of an `inputVideo` is as long as its source, so Puter holds the price of the longest source the model accepts (16 seconds on Kling 3.0 Omni, 10 on Kling O1) and charges for the length of the clip Kling returns.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above (full id or alias) |
| `prompt` | `String` | Up to 3,072 characters on the Kling 3.0 models, 2,500 on the others and on Kling 3.0 Turbo with `input_reference` |
| `seconds` | `Number` | Clip length, from the table above. Any other value falls back to `5`. Ignored with `inputVideo` |
| `size` | `String` | Resolution tier: `'720p'`, `'1080p'` or `'4k'` (case-insensitive), or `'WIDTHxHEIGHT'`. The `resolution` option is an alias |
| `width` | `Number` | Optional. Only the ratio of `width` to `height` is used, to pick the aspect ratio: `16:9`, `9:16` or `1:1`. Any other ratio gives `16:9`. A clip from `input_reference` or `inputVideo` takes the image's or video's shape |
| `height` | `Number` | Works the same way as `width` |
| `generate_audio` | `Boolean` | Generate a soundtrack on models with optional audio. Defaults to `false`. With `inputVideo`, the clip keeps the source video's sound unless this is `false` |
| `input_reference` | `String \| Blob` | Image used as the first frame, in any [image input](#image-inputs) format. JPEG or PNG, at least 300 pixels per side |
| `last_frame` | `String \| Blob` | Image used as the last frame, same formats. Requires `input_reference` |
| `reference_images` | `Array<String \| Blob>` | Images the model uses as subject, style or scene references, same formats. Kling O1 doesn't take them with `last_frame` |

An option the model lacks, or a combination it doesn't support, is rejected with `bad_request` before any credits are spent. Clips carry no watermark. Kling returns a hosted URL that stays available for 30 days.

Kling 3.0 Omni and Kling O1 edit a video passed as `inputVideo`. The video must be MP4 or QuickTime, up to 200 MiB for a Puter file, and 3 to 15.5 seconds long on Kling 3.0 Omni or 3 to 10 seconds on Kling O1. Kling doesn't take a `data:` URI. It fetches a URL itself, and gets a Puter file as a link that works for 19 minutes, which it fetches when the job starts. A video Kling can't decode fails with `upstream_bad_request` and isn't charged. Up to 4 `reference_images` can go with the video.

For more details, see the [Kling video API reference](https://kling.ai/document-api/api/video/3-0-omni/text-to-video).

### MiniMax models

Available when using a MiniMax model (provider `'minimax-video-generation'`). The ids are MiniMax's own model names in lower case, and every model also answers to `minimax/<model>`. The H3 models take any whole number of seconds in their range and are priced per second. The Hailuo models render a 6 or 10 second clip for a flat price. All of them work in resolution tiers: pass `size` as a tier, or as `'WIDTHxHEIGHT'`, which selects the tier of the shorter side and the aspect ratio. Pass `'2k'` by name. They render at 24 frames per second.

| Model | Duration (s) | Resolutions | Audio | Last frame | Reference images |
|-------|--------------|-------------|-------|------------|------------------|
| `minimax-h3` (default) | 4 to 15, default 5 | `768p`, `2k` | Always | Yes | Up to 5 images in total |
| `minimax-h3-highspeed` | 4 to 15, default 5 | `768p` | Always | Yes | Up to 5 images in total |
| `minimax-h3-lite` | 4 to 15, default 5 | `768p`, `480p` | Always | Yes | Up to 5 images in total |
| `minimax-h3-max` | 5 to 15, default 5 | `768p`, `480p` | Always | Yes | Up to 2 images in total |
| `minimax-hailuo-2.3` | 6 or 10 | `768p`, `1080p` (6 seconds only) | No | No | No |
| `minimax-hailuo-2.3-fast` | 6 or 10 | `768p`, `1080p` (6 seconds only) | No | No | No |
| `minimax-hailuo-02` | 6 or 10 | `768p`, `1080p` (6 seconds only), `512p` (with `input_reference` only) | No | Yes | No |

The first resolution listed is the default. "Images in total" counts `input_reference`, `last_frame` and `reference_images` together. Hailuo 2.3 Fast requires an `input_reference` image. Hailuo 02 supports `512p` with a first frame alone. First and last frames together require `768p` or `1080p`.

| Model | Price |
|-------|-------|
| `minimax-h3` | $0.08 per second at `768p`, $0.13 at `2k` |
| `minimax-h3-highspeed` | $0.06 per second |
| `minimax-h3-lite` | $0.04 per second at `768p`, $0.025 at `480p` |
| `minimax-h3-max` | $0.08 per second at `768p`, $0.05 at `480p` |
| `minimax-hailuo-2.3` | $0.28 for 6 seconds at `768p`, $0.56 for 10 seconds at `768p`, $0.49 for 6 seconds at `1080p` |
| `minimax-hailuo-2.3-fast` | $0.19 for 6 seconds at `768p`, $0.32 for 10 seconds at `768p`, $0.33 for 6 seconds at `1080p` |
| `minimax-hailuo-02` | As Hailuo 2.3, plus $0.10 for 6 seconds and $0.15 for 10 seconds at `512p` |

An H3 clip is shortened to fit the balance, as described in [Cost and clip length](#cost-and-clip-length), and charged for the seconds of output MiniMax reports. The Hailuo models are priced per clip, so those requests are either accepted at the clip's price or rejected with `insufficient_funds`.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use, from the table above |
| `prompt` | `String` | Up to 7,000 characters on the H3 models, 2,000 on the Hailuo models |
| `seconds` | `Number` | Clip length, from the table above. Any other value falls back to the default. On the Hailuo models, 10 seconds at `1080p` falls back to 6 |
| `size` | `String` | Resolution tier from the table above (case-insensitive), or `'WIDTHxHEIGHT'`. The `resolution` option is an alias |
| `width` | `Number` | Optional. Only the ratio of `width` to `height` is used, to pick the aspect ratio of an H3 clip made from text or `reference_images`: `21:9`, `16:9`, `4:3`, `1:1`, `3:4` or `9:16`. Any other ratio gives `16:9`. A clip from `input_reference` or `last_frame` takes the image's shape. The Hailuo models ignore them |
| `height` | `Number` | Works the same way as `width` |
| `input_reference` | `String \| Blob` | Image used as the first frame, in any [image input](#image-inputs) format. Required on Hailuo 2.3 Fast. JPEG, PNG or WebP, at least 256 pixels per side on the H3 models and more than 300 pixels on the short side on the Hailuo models |
| `last_frame` | `String \| Blob` | Image used as the last frame, same formats. Requires `input_reference` and `768p` or `1080p` on Hailuo 02. The H3 models also take it alone |
| `reference_images` | `Array<String \| Blob>` | Images the model uses as subject, style or scene references, same formats, on the H3 models. Cannot be combined with `input_reference` or `last_frame` |

An option the model lacks, or a combination it doesn't support, is rejected with `bad_request` before any credits are spent. MiniMax returns a hosted URL that is temporary, so pass `puter_output_path` to keep a clip. A Hailuo link works for one hour.

For more details, see the [MiniMax video API reference](https://platform.minimax.io/docs/api-reference/video-generation-v2-create).

Any properties not set fall back to provider defaults.

## Examples

### Generate a sample clip (test mode)

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

### Generate an 8-second cinematic clip in 1080p

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

### Use Google Veo through Together AI with a negative prompt

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

### Animate a photo (image-to-video)

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

### Save the clip to the Puter filesystem

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

### Show progress and handle errors

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

### Generate a clip from Node.js

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
