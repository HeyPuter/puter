---
title: puter.ai.txt2vid()
description: Generate short video clips from text or reference images with Veo, Seedance, Kling, Wan and other models through Puter.js.
platforms: [websites, apps, nodejs, workers]
---

Given a prompt, generate a short video clip using AI. Puter routes the request to one of three upstream providers (Google Veo, Together AI, BytePlus Seedance) based on the model you pick, waits for the clip to render, and resolves with a ready-to-play video. Every model can also start from an image you supply (image-to-video), and the same option names work across providers.

## Syntax

```js
puter.ai.txt2vid(prompt, testMode = false)
puter.ai.txt2vid(prompt, options = {})
puter.ai.txt2vid({prompt, ...options})
```

## Parameters

#### `prompt` (String) (required)

The text description that guides the video generation. Describe the subject, the motion, the camera move and the mood; cues such as "slow motion", "aerial shot" or "handheld" are understood by most models.

#### `testMode` (Boolean) (optional)

When `true`, the call returns a short sample clip hosted by Puter instead of contacting a provider, so you can build your UI without spending credits. Defaults to `false`.

Test mode still resolves the `model` you asked for and still validates (and writes to) `puter_output_path`, so it catches misspelled model ids and permission problems before you go live.

#### `options` (Object) (optional)

Additional settings for the generation request. The options below carry the same meaning on every provider; each provider then accepts a few extras, listed in the sections that follow. Any option a provider does not recognize is ignored.

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `String` | Text description for the video generation |
| `model` | `String` | Video model to use. Defaults to `'veo-3.1-lite'`. See [Choosing a model](#choosing-a-model) |
| `provider` | `String` | Pin the request to one provider: `'gemini-video-generation'`, `'together-video-generation'` or `'byteplus-video-generation'`. Only needed when a model id exists on more than one provider |
| `seconds` | `Number` | Target clip length in seconds. Each model supports a fixed set of durations; an unsupported value falls back to the model default instead of failing. `duration` is an alias |
| `size` | `String` | Output size as `'WIDTHxHEIGHT'` (e.g. `'1280x720'`) on every provider. Models that work in resolution tiers take the tier of the shorter side plus the aspect ratio, and also accept the tier directly (`'720p'`). An unsupported value falls back to the model default. `resolution` is an alias |
| `width`, `height` | `Number` | Output size in pixels on Together AI models sized in pixels; the aspect ratio on Seedance and Wan 2.7. Filled in from `size` when you leave them out |
| `input_reference` | `String` | Image the clip starts from (image-to-video): a public URL, a `data:` URI or raw base64, on every provider |
| `last_frame` | `String` | Image the clip ends on, same formats. Requires `input_reference` on Seedance |
| `reference_images` | `Array<String>` | Images the model keeps consistent as subjects or style, same formats. Limits per provider are listed below; not combined with `input_reference` or `last_frame` |
| `negative_prompt` | `String` | Text describing what to avoid in the video (Veo and Together AI) |
| `seed` | `Number` | Random seed for reproducible results (Together AI and Seedance 1.x) |
| `generate_audio` | `Boolean` | Generate a soundtrack, on models that support audio (Seedance and Together AI models with audio; Veo always includes audio) |
| `test_mode` | `Boolean` | When `true`, returns a sample video without using credits |
| `puter_output_path` | `String` | When set, the generated video is automatically saved to this path on the Puter filesystem. Relative paths are resolved against the app's data directory (or `~/` outside an app). The caller must have write permission to the destination |

#### Choosing a model

Model ids are matched case-insensitively, and every model answers to a few spellings: the fully qualified id, the `org/model` form and the bare model name. `'google:google/veo-3.1-lite'`, `'google/veo-3.1-lite'`, `'veo-3.1-lite'` and `'veo-3.1-lite-generate-preview'` all select the same model. When a bare name is served by more than one provider (`'veo-3.1'` is offered by Google directly and through Together AI) Puter picks the cheaper listing; pass `provider` or the fully qualified id to choose explicitly.

When you pass no model, Puter uses Veo 3.1 Lite on Google (`veo-3.1-lite`). A self-hosted Puter without a Google key falls back to the first provider it has a key for.

`seconds` and `size` are normalized rather than rejected: a value the model does not offer is replaced by the model default, which is the first value listed in the tables below and also what you get when you leave the option out.

#### Image inputs

`input_reference`, `last_frame` and `reference_images` take the same three formats everywhere: a public image URL, a `data:` URI, or raw base64 (treated as PNG). Providers that need inline bytes fetch URLs server-side, so a URL works on every model. What each provider does with them:

| Provider | First frame | Last frame | Reference images |
|----------|-------------|------------|------------------|
| Google Veo 3.1 | Yes | Yes | Up to 3; forces an 8 second clip; `input_reference` and `last_frame` are ignored when set |
| Together AI | Models with a `first` keyframe | Models with a `last` keyframe | Model-dependent (Seedance 2.5: up to 30) |
| BytePlus Seedance | Yes | Yes, with `input_reference` | Seedance 2.0: up to 9; Seedance 2.5: up to 30; cannot be combined with frames |

#### Google (Veo) options

Available when using a Veo 3.1 model (provider `'gemini-video-generation'`). Google has retired Veo 3.0; Veo 2.0 is offered through Together AI instead (see the next section).

| Model | Aliases | Durations (s) | Sizes | Reference images |
|-------|---------|---------------|-------|------------------|
| `veo-3.1-lite-generate-preview` (default) | `veo-3.1-lite`, `google/veo-3.1-lite` | `4`, `6`, `8` | `1280x720`, `720x1280`, `1920x1080`, `1080x1920` | Up to 3 |
| `veo-3.1-fast-generate-preview` | `veo-3.1-fast`, `google/veo-3.1-fast` | `4`, `6`, `8` | `1280x720`, `720x1280`, `1920x1080`, `1080x1920`, `3840x2160`, `2160x3840` | Up to 3 |
| `veo-3.1-generate-preview` | `veo-3.1`, `google/veo-3.1` | `4`, `6`, `8` | `1280x720`, `720x1280`, `1920x1080`, `1080x1920`, `3840x2160`, `2160x3840` | Up to 3 |

Sizes map onto Veo's aspect ratio (16:9 or 9:16) and resolution tier (720p, 1080p or 4K). 1080p and 4K clips, and any request that uses `reference_images`, are always 8 seconds long regardless of `seconds`. Veo is billed per second; 4K costs more than 720p and 1080p, and on Veo 3.1 Fast and Veo 3.1 Lite 1080p costs more than 720p. Every Veo clip comes with a generated soundtrack.

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use. Available: `'veo-3.1-lite-generate-preview'` (default), `'veo-3.1-fast-generate-preview'`, `'veo-3.1-generate-preview'` or any alias above |
| `seconds` | `Number` | Clip length: `4` (default), `6` or `8` |
| `size` | `String` | Output dimensions from the table above. Defaults to `'1280x720'`. `resolution` is an alias |
| `negative_prompt` | `String` | Text describing what to avoid in the video |
| `input_reference` | `String` | Image used as the first frame (image-to-video): URL, `data:` URI or raw base64 |
| `last_frame` | `String` | Image used as the last frame, same formats. Ignored when `reference_images` is set |
| `reference_images` | `Array<String>` | Up to 3 images (same formats) the model uses as subject or style references. When set, `input_reference` and `last_frame` are ignored and the clip is 8 seconds long |

For more details, see the [Google Veo API reference](https://ai.google.dev/gemini-api/docs/video).

#### Together AI options

Available when using any model below (provider `'together-video-generation'`). Pass the model as `'org/model'`, or prefix it with `togetherai:` to make the routing explicit; `'togetherai:google/veo-3.1'` runs Veo through Together AI while a bare `'veo-3.1'` goes to Google directly.

Together AI models are priced in one of two ways, marked in the table:

- **Per clip.** The model renders a fixed-length clip for a flat price. The request is either affordable or rejected with `insufficient_funds`.
- **Per second.** Newer models are billed per second of output at a rate that depends on the resolution. Puter estimates the cost from the highest published rate before the request, shortens the clip to fit the remaining balance (see [Cost and clip length](#cost-and-clip-length)), and then charges the exact amount Together AI reports for the finished job.

Most models size their output in pixels: pass `size` as `'WIDTHxHEIGHT'` (or `width` and `height` directly) from the combinations each model advertises in the sizes column. Seedance 2.5 and Wan 2.7 instead work in resolution tiers, so `size` picks the tier of the shorter side (or name the tier directly), and Wan 2.7 takes the aspect ratio from it. "Keyframes" says whether the model can start from an image (`first`) and also end on one (`last`); supply them through `input_reference` and `last_frame`, or through `frame_images` for finer control. "Provider default" means Together AI has not published the values: the model applies its own defaults, and a `seconds` or size it does not accept is rejected with `upstream_bad_request`.

| Model | Pricing | Duration (s) | Sizes | FPS | Keyframes | Notes |
|-------|---------|--------------|-------|-----|-----------|-------|
| `minimax/video-01-director` (default) | Per clip | 5 | `1366x768` | 25 | first | |
| `minimax/hailuo-02` | Per clip | 10 | `1366x768`, `1920x1080` | 25 | first | |
| `google/veo-2.0` | Per clip | 5 | `1280x720`, `720x1280` | 24 | first, last | |
| `google/veo-3.1` | Per second | `4`, `6`, `8` | provider default | 24 | first, last | Pass as `togetherai:google/veo-3.1`; a bare `veo-3.1` goes to Google directly |
| `google/veo-3.1-lite` | Per second | `4`, `6`, `8` | provider default | 24 | first, last | Pass as `togetherai:google/veo-3.1-lite` |
| `bytedance/seedance-1.0-lite` | Per clip | 5 | `864x480`, `736x544`, `640x640`, `960x416`, `416x960`, `1248x704`, `1120x832`, `960x960`, `1504x640`, `640x1504` | 24 | first, last | |
| `bytedance/seedance-1.0-pro` | Per clip | 5 | same as Seedance 1.0 Lite | 24 | first, last | |
| `bytedance/seedance-2.0` | Per second | 4 to 15, default 5 | provider default | 24 | first, last | Soundtrack generated by default |
| `bytedance/seedance-2.5` | Per second | 4 to 30, default 5 | `720p`, `480p` | 24 | first, last | Soundtrack always generated; up to 30 `reference_images`; no aspect ratio control |
| `pixverse/pixverse-v5` | Per clip | 5 | 360p, 540p, 720p or 1080p in 16:9, 4:3, 1:1, 3:4 or 9:16 (e.g. `1280x720`, `720x720`, `720x1280`) | 16, 24 | first, last | |
| `pixverse/pixverse-v5.6` | Per second | provider default | provider default | | | |
| `pixverse/pixverse-v6` | Per second | provider default | provider default | | | |
| `kwaivgi/kling-2.1-master` | Per clip | 5 | `1920x1080`, `1080x1080`, `1080x1920` | 24 | first | |
| `kwaivgi/kling-2.1-standard` | Per clip | 5 | `1920x1080`, `1080x1080`, `1080x1920` | 24 | first | Image-to-video: requires a first frame |
| `kwaivgi/kling-2.1-pro` | Per clip | 5 | `1920x1080`, `1080x1080`, `1080x1920` | 24 | first, last | Image-to-video: requires a first frame |
| `kwaivgi/kling-1.6-standard` | Per clip | 5 | `1920x1080`, `1080x1080`, `1080x1920` | 30, 24 | first | |
| `wan-ai/wan2.7-t2v` | Per second | 2 to 15, default 5 | `720P`, `1080P` in 16:9, 9:16, 1:1, 4:3 or 3:4 | 30 | | Soundtrack generated |
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
| `black-forest-labs/flux-3` | Per second | provider default | provider default | | | |

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
| `input_reference` | `String` | First-frame image (URL, `data:` URI or base64); sent as the model's first keyframe |
| `last_frame` | `String` | Last-frame image, same formats; sent as the model's last keyframe |
| `reference_images` | `Array<String>` | Reference images to guide the generation |
| `frame_images` | `Array<Object>` | Explicit keyframes, overriding `input_reference` and `last_frame`. Each object has `input_image` (`String`) and `frame` (`Number`, the frame position the image anchors; `0` is the first frame). One image is the first frame; two are the first and last |
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
| `seedance-1-5-pro-251215` | `seedance-1-5-pro` | 4 to 12, default 5 | `720p`, `480p`, `1080p` | Yes | Yes | No | Yes |
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
| `input_reference` | `String` | Image used as the first frame (image-to-video): a public image URL or a `data:` URI |
| `last_frame` | `String` | Image used as the last frame, same formats. Requires `input_reference` |
| `reference_images` | `Array<String>` | Images (URL or `data:` URI) the model uses as subject or style references: up to 9 on the Seedance 2.0 models, up to 30 on Seedance 2.5. Cannot be combined with `input_reference` or `last_frame` |

An invalid combination (a last frame without a first frame, reference images together with a first frame, or an option the model lacks) is rejected with `bad_request` before any credits are spent.

For more details, see the [BytePlus ModelArk video generation reference](https://docs.byteplus.com/en/docs/ModelArk/1520757).

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

- **Veo and Seedance** are priced per second. If the balance cannot cover the requested length, Puter shortens the clip to the longest duration the model supports that the balance does cover, and rejects with `insufficient_funds` only when even the shortest clip is unaffordable. The response does not flag a shortened clip, so read `video.duration` once metadata has loaded if the exact length matters. Veo clips at 1080p or 4K, or with `reference_images`, are fixed at 8 seconds and therefore all-or-nothing.
- **Together AI** prices its older models per clip, so those requests are either accepted at the model's duration or rejected with `insufficient_funds`. Its per-second models (marked in the Together AI table) are shortened like Veo and Seedance, and the final charge is the amount Together AI reports for the job.

A request that fails or times out is not charged. The request and concurrency limits that apply to every AI call are listed in [Rate limits and quotas](/rate-limits-and-quotas/).

#### How long it takes

Video generation is slow: expect anywhere from tens of seconds to several minutes, growing with duration and resolution. The returned promise stays pending until the clip is ready, so keep the UI responsive with a progress indicator (see the examples below). Puter waits up to ten minutes for a job; one that outlives the window fails with `upstream_timeout`.

## Return value

A `Promise` that resolves to an `HTMLVideoElement` (in browsers) that you can append to the DOM straight away:

- `src` is the clip's URL. Depending on the provider it is either an `https:` URL on the provider's storage (Together AI, Seedance, and usually Veo) or a `data:` URI holding the whole clip (Veo, when Google returns the bytes inline). Provider URLs are temporary; keep a copy with `puter_output_path` if you need the clip later.
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
| `provider` | Which upstream handled the request: `gemini` (Veo), `together` or `byteplus`. Present on errors raised while a job was running. |
| `upstreamCode` | The provider's own error code, when it gave one. |
| `upstreamStatus` | The HTTP status the provider returned, when it rejected the request before a job started. |

| Code | Meaning |
| --- | --- |
| `prompt_required` | Raised by the SDK before any request is made: the call had no prompt. |
| `bad_request` (without `errorCode`) | Puter rejected the request before contacting a provider: an unknown `model` (`Model not found: …`), an invalid combination of image inputs, or an image URL that could not be fetched. `message` says which. Arrives as HTTP 400. |
| `access_denied` | `puter_output_path` points somewhere the caller may not write. Arrives as HTTP 403, before any credits are spent. `cannot_write_to_root` (HTTP 400) is the same check for a path directly under `/`. |
| `upstream_timeout` | The provider did not finish the clip within the ten minutes Puter waits for it, or stopped answering. Arrives as HTTP 504. The request itself was fine; retry it, ideally with a shorter clip or a faster model. |
| `errorCode: moderation_flagged` | The provider's content filter refused the prompt or removed the generated video. Arrives as HTTP 400, with `code: bad_request` from Together and BytePlus and `code: disallowed_value` from Veo. Change the prompt rather than retrying it as-is. |
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
            model: "veo-3.1-fast",
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

<strong class="example-title">Use a Google Veo model with a negative prompt</strong>

```html;ai-txt2vid-veo
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid("A hummingbird hovering over a red flower, macro lens, soft morning light", {
            model: "veo-3.1-fast",
            seconds: 6,
            size: "1280x720",
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

            // Seedance and Veo take the first frame as a data: URI
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
                // No model given: the default Veo 3.1 Lite is used
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
