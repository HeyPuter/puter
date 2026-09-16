---
title: puter.ai.txt2img()
description: Generate images from text prompts using AI models like GPT Image, Nano Banana, Grok Image, or FLUX.
platforms: [websites, apps, nodejs, workers]
---

Given a prompt, generate an image using AI.

## Syntax

```js
puter.ai.txt2img(prompt, testMode = false)
puter.ai.txt2img(prompt, options = {})
puter.ai.txt2img({ prompt, ...options })
```

## Parameters

#### `prompt` (String) (required)

A non-empty string describing the image. Missing, blank, or non-string prompts reject with `prompt_required` before any request is made.

#### `testMode` (Boolean) (Optional)

A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

#### `options` (Object) (Optional)

Additional settings for the generation request. Available options depend on the provider.

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `String` | Text description for the image generation |
| `provider` | `String` | Optional provider: `'openai'`, `'gemini'`, `'cloudflare'`, `'xai'`, `'replicate'`, or `'byteplus'` (`'together'` is still recognized, but every Together route is currently excluded). Full `*-image-generation` IDs also work. This is a preference: if it does not offer the requested model, Puter selects a provider that does. Selecting a route excluded by data policy returns `bad_request` instead. Inferred from `model` when omitted; use a provider-prefixed model ID to select an exact provider. |
| `model` | `String` | Image model ID. See the provider defaults and model discovery below. Lookups are case-insensitive; provider-prefixed IDs select that provider. |
| `test_mode` | `Boolean` | When `true`, returns a sample image without using credits |
| `puter_output_path` | `String` | When set, the generated image is automatically saved to this path on the Puter filesystem. Relative paths are resolved against the app's data directory (or `~/` outside an app). The caller must have write permission to the destination |
| `input_images` | `Array<String>` | Input image(s) for image-to-image — the canonical, cross-provider field (see below). |
| `input_image` | `String` | Single-image shorthand for `input_images`. |
| `input_image_mime_type` | `String` | MIME type of the input image(s), e.g. `'image/png'`. Used as a fallback when the type cannot be detected from the input — pass it when supplying raw base64 without a data-URI prefix. |

#### Providers and model discovery

When `model` is supplied, Puter selects its provider. Use a provider-prefixed ID such as `workers-ai:leonardo/lucid-origin` or `replicate:leonardoai/lucid-origin` to choose between providers offering similar models. A `provider` or legacy `driver` hint prefers that provider when it offers the model; otherwise a known model selects its own provider, preserving existing callers. A hint selecting a route excluded by data policy fails with `bad_request` instead of falling back. The generic `ai-image` hint is case-insensitive. The legacy `driver` option accepts full driver IDs such as `xai-image-generation`; `service` does not select an image provider.

Without a model, these provider defaults apply:

| Provider | Default model |
|----------|---------------|
| OpenAI | `gpt-image-2` |
| Gemini | `gemini-3.1-flash-image` |
| Cloudflare | `@cf/black-forest-labs/flux-1-schnell` |
| xAI | `grok-imagine-image` |
| Replicate | `black-forest-labs/flux-schnell` |
| BytePlus | `seedream-5-0-lite-260128` |

When neither is supplied, the first configured provider with an available default model is used, with OpenAI preferred. Self-hosted instances expose only configured providers.

Discover the image catalog, including model IDs, aliases, provider names, and pricing metadata:

```js
const { result: models } = await puter.drivers.call(
    'puter-image-generation', 'models', {}
);
console.table(models.map(({ id, provider }) => ({ id, provider })));
```

See the [image model catalog and pricing sources](/AI/image-models) for the included models and price units.

`puter.ai.listModels()` lists chat models. The image catalog above describes configured integrations; upstream account access and availability can still vary.

**Availability notes (September 16, 2026):**

- Gemini `gemini-3-pro-image` and `gemini-3.1-flash-image` use stable endpoints. Their previous `-preview` spellings remain aliases. `gemini-2.5-flash-image` is scheduled for retirement on October 2, 2026. Google's table names `gemini-3.1-flash-image-preview` as its replacement; that preview id itself retired on June 25, 2026 in favor of `gemini-3.1-flash-image`, the default here. See [Google's deprecation schedule](https://ai.google.dev/gemini-api/docs/deprecations).
- OpenAI has deprecated `gpt-image-1`, `gpt-image-1-mini`, and `gpt-image-1.5`, with shutdowns on October 23, 2026 (`gpt-image-1`) and December 1, 2026 (the other two). They stay routable by id until then but are hidden from the catalog listing; after shutdown they will fail with `bad_request`. Use `gpt-image-2` or a `gpt-image-2.5-*` model for new work. `chatgpt-image-latest` was never offered. `replicate:openai/gpt-image-1.5` is also available through Replicate. See [OpenAI's deprecation schedule](https://developers.openai.com/api/docs/deprecations).
- All cataloged Together image routes are excluded because they require a third-party data-sharing opt-in. This includes Imagen 4; its retirement through Together has not been confirmed. Excluded routes are not listed and reject generation before contacting the provider. See [data-use details](/AI/image-models#data-use). Previously retired Together aliases still fail as unavailable. To use Cloudflare Schnell, select `@cf/black-forest-labs/flux-1-schnell` or `workers-ai:black-forest-labs/flux.1-schnell`.
- Cloudflare `@cf/black-forest-labs/flux-2-dev` timed out on every live request on September 16, 2026, including 512×512 at 4 steps, while the Klein variants respond normally. It stays listed pending a Cloudflare-side fix.
- xAI `grok-imagine-image-2.0` is available. `grok-imagine-image-quality` is scheduled to redirect to the new model on November 2, 2026; the original `grok-imagine-image` remains available. See [xAI's release notes](https://docs.x.ai/developers/release-notes).

#### Output dimensions

Use `ratio: { w: 16, h: 9 }`, `aspect_ratio: '16:9'`, or a pair of pixel dimensions (`width`, `height`). `ratio` takes precedence, followed by `width`/`height`, then `aspect_ratio`. `aspect_ratio` always denotes a shape. Legacy dimension pairs with both sides at most 32 also denote shapes; BytePlus retains its pixel-threshold rule described below. Invalid, non-positive, or non-finite dimensions fail with `bad_request`.

Supported shapes and sizes vary by model. Gemini and BytePlus choose the closest supported aspect ratio; OpenAI scales any aspect hint into its pixel budget. Cloudflare expands aspect hints to about one megapixel, then scales or clamps dimensions to the per-side limits below. Cloudflare Schnell always generates 1024×1024 images.

#### Input images (image-to-image)

`input_images` is the universal way to pass image-to-image inputs across providers; `input_image` is the single-image shorthand. Each entry may be a **public URL**, a **data-URI**, or **raw base64** — providers that need base64 fetch URLs server-side (SSRF-guarded), so a URL works everywhere.

Raw base64 carries no MIME type of its own. When it cannot be detected from the bytes, set `input_image_mime_type` (e.g. `'image/png'`) — Gemini rejects the request otherwise, and OpenAI, xAI, Cloudflare, BytePlus, and Replicate use it to label the upload.

| Provider | Multiple images? | Accepted input forms |
|----------|------------------|----------------------|
| OpenAI `gpt-image-*` | Yes | URL, base64 / data-URI |
| Gemini | Yes | URL, base64 / data-URI |
| Replicate | Up to 10 (400 if exceeded); model-dependent | URL, base64 / data-URI |
| xAI `grok-imagine-*` | Up to 5 (400 if exceeded) | URL, base64 / data-URI |
| Cloudflare FLUX.2 | Single only (400 if more than one) | URL, base64 / data-URI. Inpainting also accepts one reference; SDXL, Schnell, and Leonardo models are text-to-image only and reject references. |
| BytePlus | Up to 10 for Seedream 5.0 Pro; 14 for other Seedream models | URL, base64 / data-URI |

#### OpenAI Options

Available when `provider: 'openai'` or inferred from model (`gpt-image-2.5-sunburst`, `gpt-image-2.5-flare`, `gpt-image-2`):

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Image model to use. Available: `'gpt-image-2.5-sunburst'`, `'gpt-image-2.5-flare'`, `'gpt-image-2'` (default). The deprecated `'gpt-image-1.5'`, `'gpt-image-1-mini'`, and `'gpt-image-1'` still route until their shutdown dates (fixed 1024×1024, 1024×1536, or 1536×1024 sizes; `'low'`, `'medium'`, `'high'` only). |
| `quality` | `String` | Image quality: `'high'`, `'medium'`, `'low'` (default: `'low'`); `gpt-image-2` also accepts `'auto'`, and the `gpt-image-2.5-*` models also accept `'xhigh'`, `'max'`, and `'auto'`. Case-insensitive; unrecognized values fall back to `'low'`. |
| `ratio` | `Object` | Aspect ratio with `w` and `h` properties. All GPT Image models accept dynamic sizes subject to provider limits (16-pixel steps, 3:1 maximum ratio, 3840-pixel edge cap) |
| `input_image` | `String` | An input image for image-to-image editing — a URL or base64/data-URI (URLs are fetched server-side). |
| `input_images` | `Array<String>` | Multiple input images (URL or base64/data-URI) for image-to-image editing. Routes the request through OpenAI's image edit endpoint. |

For more details, see the [OpenAI API reference](https://platform.openai.com/docs/api-reference/images/create).

#### Gemini Options

Available when `provider: 'gemini'` or inferred from model:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | `'gemini-3.1-flash-image'` (default), `'gemini-3.1-flash-lite-image'`, `'gemini-3-pro-image'`, or `'gemini-2.5-flash-image'`. |
| `ratio` | `Object` | Aspect ratio as `{ w, h }` (e.g., `{ w: 16, h: 9 }`). |
| `quality` | `String` | 3 Pro: `'1K'`, `'2K'`, `'4K'`; 3.1 Flash: `'512'`, `'1K'`, `'2K'`, `'4K'`; 3.1 Flash Lite: `'1K'`. Case-insensitive; a tier the model does not offer returns `bad_request` before any credits are checked. Ignored by 2.5 Flash. Defaults to the first supported tier: `'512'` on 3.1 Flash, `'1K'` on 3 Pro and 3.1 Flash Lite. |
| `input_images` | `Array<String>` | Input images for image-to-image — a URL or base64/data-URI (URLs are fetched server-side). |

#### xAI (Grok) Options

Available when `provider: 'xai'` or inferred from model (`grok-imagine-image`, alias `grok-image`):

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Image model to use. Available: `'grok-imagine-image'` (default), `'grok-imagine-image-quality'`, `'grok-imagine-image-2.0'` |
| `prompt` | `String` | Text prompt for the image (or the edit instruction when input images are supplied). |
| `resolution` | `String` | Output resolution: `'1k'` (default) or `'2k'`. |
| `quality` | `String` | On 2.0 (case-insensitive): `'low'`, `'medium'`, or `'auto'` (default; low for generation, medium for edits). On older models, `'1k'`/`'2k'` remains a resolution alias. Explicit `resolution` takes precedence. |
| `input_image` | `String` | A public URL or base64-encoded (data-URI) input image for image-to-image editing. |
| `input_images` | `Array<String>` | Up to 5 input images (URLs or base64/data-URI) for multi-image editing — combine subjects, transfer styles, compose scenes. Routes through xAI's image edit endpoint. |

#### Together Options

Together image routes are excluded under the [data-use policy](/AI/image-models#data-use). Existing provider IDs and the Together-only SDK options (`image_url`, `image_base64`, `mask_image_url`, `mask_image_base64`, `prompt_strength`, and `response_format` as `'base64'`/`'url'`) remain recognized for compatibility but have no effect, and selecting an excluded route rejects with `bad_request`, including in test mode.

#### Cloudflare Options

Use `provider: 'cloudflare'`, a `@cf/...` model ID, or its `workers-ai:...` alias. Available models are FLUX.1 Schnell, FLUX.2 Dev, FLUX.2 Klein 4B/9B, Lucid Origin, Phoenix 1.0, SDXL Lightning, SDXL Base 1.0, and Stable Diffusion 1.5 Inpainting.

| Option | Type | Description |
|--------|------|-------------|
| `steps` | `Number` | Schnell: 1–8, default 4. Lucid Origin: 1–40, default 25. Phoenix and FLUX.2 Dev: 1–50, default 25. Klein models always use 4 steps. SDXL and Inpainting: 1–20, default 20. |
| `width`, `height` | `Number` | Pixel dimensions; ignored by Schnell. Clamped to 256–1920 per side for FLUX.2, 64–2500 for Lucid Origin, 64–2048 for Phoenix, and 256–2048 for SDXL and Inpainting. Aspect hints are scaled to fit; shapes wider or taller than the bounds permit are clamped. |
| `seed` | `Number` | Reproducibility seed on models other than Schnell. |
| `guidance` | `Number` | Prompt guidance on models other than Schnell. |
| `negative_prompt` | `String` | Content to exclude (Phoenix, SDXL, and Inpainting). |
| `input_image`, `input_images` | `String`, `Array<String>` | One reference image for FLUX.2 and Inpainting models. Inpainting requires an image; SDXL models reject one. |
| `maskImage` | `String` | Mask URL, data URI, or raw base64 for Inpainting; requires an input image. |
| `strength` | `Number` | Transformation strength for Inpainting image editing. |

Output encoding is selected by the model; `response_format` does not change Cloudflare output.

#### BytePlus Options

Use `provider: 'byteplus'` or a Seedream model ID. Available models are `dola-seedream-5-0-pro-260628`, `seedream-5-0-lite-260128`, `seedream-4-5-251128`, and `seedream-4-0-250828`.

| Option | Type | Description |
|--------|------|-------------|
| `quality` | `String` | Output tier, case-insensitive. Pro: `1K`, `1.5K`, `2K`; Lite: `2K`, `3K`, `4K`; 4.5: `2K`, `4K`; 4.0: `1K`, `2K`, `4K`. Default `2K`. Legacy aliases: `low` → `1K`, `medium` → `1.5K`, `high`/`hd` → `2K`. Unsupported tiers move to the next supported tier, or the largest supported tier if no larger one exists. |
| `ratio` | `Object` | Aspect ratio or explicit pixel dimensions. The closest supported aspect ratio maps to the model's output tier. |
| `input_image`, `input_images` | `String`, `Array<String>` | Reference images; up to 10 for Pro, 14 for other models. |

For compatibility, a dimension pair containing fewer than 921,600 total pixels is treated as an aspect-ratio hint and mapped to the selected tier. Larger pairs are explicit sizes and must satisfy both the pixel-count and aspect-ratio constraints in [Rate Limits and Quotas](/rate-limits-and-quotas#image-generation). See the [ModelArk image API reference](https://docs.byteplus.com/en/docs/ModelArk/1541523).

#### Replicate Options

Available when `provider: 'replicate'` or inferred from model:

##### Common options

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Model id (e.g. `'black-forest-labs/flux-schnell'`, `'leonardoai/lucid-origin'`). |
| `ratio` | `Object` | Aspect ratio as `{ w, h }` (e.g., `{ w: 16, h: 9 }`). |
| `input_image` | `String` | Input image for image-to-image generation — a URL or base64/data-URI. |
| `input_images` | `Array<String>` | Up to 10 input images (URL or base64/data-URI) for multi-image generation; more return `bad_request` before anything is fetched. Each fetched reference is capped at 30 MB; a larger one fails with `bad_request` before the request is sent. |

##### Per-model options

Available options depend on the model. The expanded catalog includes FLUX variants, Nano Banana, Seedream, Ideogram, Recraft, Qwen, Hunyuan, Wan, Riverflow, and community models. Use a `replicate:`-prefixed ID to select Replicate explicitly.

For the additional models, `quality` (or the model's own `resolution` field, where it has one) selects a native quality or resolution tier, and `ratio`/`width`/`height` select supported dimensions. `steps`, `guidance`, `negative_prompt`, and `strength` map to the corresponding native controls when supported. `maskImage` supplies an inpainting mask. Explicit pixel controls round to multiples of 8 and obey model bounds, defaulting to 64–4096 per side when the schema omits a bound. Pass additional native options in `providerOptions`; native snake_case and camelCase spellings work. Common options take precedence, unsupported fields are omitted, and invalid values return `bad_request`. Image counts are fixed at one where the model exposes a count option. Models returning SVG still use the same image return shape.

Specialized models require their inputs: control/fill/redux models need a reference image; `any-comfyui-workflow` needs `providerOptions.workflowJson` containing a ComfyUI API workflow that produces images. A workflow controls its own graph and outputs. MiniMax Image 01 uses a human-face reference as its subject.

```js
const image = await puter.ai.txt2img("A colorful ceramic cup", {
    model: "replicate:google/nano-banana-2",
    quality: "2K",
    ratio: { w: 16, h: 9 },
    providerOptions: { outputFormat: "png" }
});
document.body.append(image);
```

Billing follows the selected model and tier: per image, per input/output megapixel, or per second of reported prediction runtime. Runtime-priced entries use a 60-second estimate for the initial credit check and record actual runtime after generation; runtime is billed up to the 10-minute prediction deadline, so a long run can exceed the estimate. See the [image model catalog and pricing sources](/AI/image-models).

The original Replicate entries also support these options:

| Option | Type | Models | Description |
|--------|------|--------|-------------|
| `seed` | `Number` | most models | Random seed for reproducible generation. |
| `steps` | `Number` | `flux-schnell` | Number of inference steps, 1–4. |
| `guidance` | `Number` | `flux-2-klein-9b-base` | Guidance scale. |
| `go_fast` | `Boolean` | `flux-2-dev` | Use optimized fast mode. Defaults to `true` for `flux-2-dev`; affects pricing. |
| `output_quality` | `Number` | flux family | Output quality (0–100). |
| `output_megapixels` | `String` | `flux-2-pro`, `flux-2-klein-*`, `flux-schnell` | Output size in megapixels, from the model's own list: `flux-2-pro` `'0.5'`, `'1'`, `'2'`, `'4'`; Klein `'0.25'`, `'0.5'`, `'1'`, `'2'`, `'4'`; `flux-schnell` `'0.25'` or `'1'`. Not accepted by `flux-2-dev` or `flux-1.1-pro`, where it is ignored. |
| `disable_safety_checker` | `Boolean` | flux-2-dev / klein / flux-schnell | If `true`, disables the safety checker. |
| `safety_tolerance` | `Number` | `flux-2-pro`, `flux-1.1-pro` | Safety tolerance level. |
| `prompt_upsampling` | `Boolean` | `flux-1.1-pro` | Enable prompt upsampling. |
| `response_format` | `String` | most models | Output format (e.g. `'webp'`, `'jpg'`, `'png'`). |
| `generation_mode` | `String` | Leonardo (`lucid-origin`) | Generation tier — affects pricing. `'standard'`/`'ultra'` (lucid-origin). |
| `style` | `String` | Leonardo | Stylistic preset. |
| `contrast` | `String` | Leonardo | Contrast preset. |
| `prompt_enhance` | `Boolean` | Leonardo | Server-side prompt enhancement. |

If a Replicate request is aborted, Puter keeps the creation response long enough to obtain the prediction ID and request cancellation. A generation that completes before cancellation is still metered. Predictions have a 10-minute [upstream deadline](https://replicate.com/docs/topics/predictions/create-a-prediction#prediction-deadlines). After the initial blocking request, Puter polls every 2 seconds and stops at the deadline with `upstream_timeout` (504). Cancellation cleanup polls for at most 30 seconds, plus any in-flight network request (30-second timeout). Each creation request has a separate 90-second network timeout and is sent once: a creation that fails on the network is not retried, so a call starts at most one prediction. A polling failure while the prediction is running surfaces as `upstream_failed` (502) without cancelling or metering it.

For more details, see the [Replicate API reference](https://replicate.com/docs) and each model's schema page on Replicate.

Any properties not set fall back to provider defaults.

#### Saving to Puter filesystem

Pass `puter_output_path` to persist the generated image directly on the Puter filesystem. Relative paths are resolved against `~/AppData/<appID>/` when called from an app, or `~/` otherwise:

```js
puter.ai.txt2img("A sunset over the mountains", {
    puter_output_path: "images/sunset.png"  // saved to ~/AppData/<appID>/images/sunset.png
});
```

Absolute paths (`/username/Pictures/sunset.png`) and home-relative paths (`~/Pictures/sunset.png`) are sent as-is. Write permission to the destination is enforced server-side.

## Return value

A `Promise` that resolves to one `HTMLImageElement` in browsers. In Node.js and workers it resolves to an object with `src`, `toString()`, and `valueOf()`. Read `image.src` for the image URL or data URI. The return shape is the same across image providers. Whether `src` is a hosted URL or a data URI depends on the provider; hosted URLs are temporary, so pass `puter_output_path` (or save the image yourself) when you need to keep the result. Because the shape is already uniform, the `normalize` option and `puter.ai.normalize` described for [`chat()`](/AI/chat#response-normalization) have no effect on `txt2img()`.

## Errors

A rejection carries the error body as the backend sent it: `{ message, code }`, plus `errorCode` when a more specific code is available alongside a general one.

| Code | Meaning |
| --- | --- |
| `prompt_required` | Raised by the SDK before any request is made: the call had no prompt, or the prompt was blank or not a string. |
| `errorCode: moderation_flagged` | The model's content filter refused the prompt or the generated image. Arrives as HTTP 400 with `code: bad_request`. Change the prompt rather than retrying it as-is. Not every provider reports refusals distinctly; when one does, this is how. |
| `upstream_failed` | The provider accepted the request but generation failed on their side. Safe to retry. |
| `insufficient_funds` | Your balance cannot cover the estimated cost of the image. Arrives as HTTP 402. |

Other `upstream_*` codes mean the provider rejected the request or was unavailable; the `message` carries the provider's reason.

## Examples

<strong class="example-title">Generate an image of a cat using AI</strong>

```html;ai-txt2img
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Generate an image of a cat using the default model and quality. Please note that testMode is set to true so that you can test this code without using up API credits.
        puter.ai.txt2img('A picture of a cat.', true).then((image)=>{
            document.body.appendChild(image);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Generate an image with specific model and quality</strong>

```html;ai-txt2img-options
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Generate an image of a cat playing piano using a specific model and quality set to low
        puter.ai.txt2img("a cat playing the piano", {
            model: "gpt-image-2",
            quality: "low"
        }).then((image)=>{
            document.body.appendChild(image);
        });
    </script>
</body>
</html>
```

<strong class="example-title">Generate an image with image-to-image generation</strong>

```html;ai-txt2img-image-to-image
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2img("a cat playing piano", {
            model: "gemini-3.1-flash-image",
            input_image: "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",
            input_image_mime_type: "image/png"
        }).then((image)=>{
            document.body.appendChild(image);
        });
    </script>
</body>
</html>
```
