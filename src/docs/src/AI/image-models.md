---
title: Image Models and Pricing
description: Image model IDs and provider pricing used by puter.ai.txt2img().
platforms: [websites, apps, nodejs, workers]
---

This catalog covers the configured image integrations for [puter.ai.txt2img()](/AI/txt2img). Prices below are USD rates configured by the image drivers. Sources were checked against authenticated model APIs on September 16, 2026, then provider pricing pages where the API omitted a price. Actual credit usage depends on the selected size, tier, reference images, tokens, or runtime. A listed model can still require upstream account access.

Use the exact model IDs below. Provider-prefixed IDs select an integration when more than one provider offers the same model. Aliases and self-hosted configuration are available through the [image model discovery call](/AI/txt2img#providers-and-model-discovery).

`MP` means one million pixels; a Cloudflare tile is 512×512 pixels, rounded up per side. Token prices are per one million tokens. Runtime models are billed for the provider-reported prediction time, with a 60-second estimate used for the initial credit check.

## OpenAI

Standard synchronous pricing from [OpenAI](https://developers.openai.com/api/docs/pricing). Output is metered by usage tokens; per-image estimates vary by size and quality.

| Model | Text input / cached | Image input / cached | Image output |
| --- | --- | --- | --- |
| `gpt-image-2.5-sunburst` | $5 / $1.25 | $8 / $2 | $30 |
| `gpt-image-2.5-flare` | $5 / $1.25 | $8 / $2 | $30 |
| `gpt-image-2` | $5 / $1.25 | $8 / $2 | $30 |
| `gpt-image-1.5` (deprecated, routable until December 1, 2026) | $5 / $1.25 | $8 / $2 | $32 |
| `gpt-image-1-mini` (deprecated, routable until December 1, 2026) | $2 / $0.2 | $2.5 / $0.25 | $8 |
| `gpt-image-1` (deprecated, routable until October 23, 2026) | $5 / $1.25 | $10 / $2.5 | $40 |

The deprecated rows are hidden from the model discovery call but still accepted by id until OpenAI's shutdown dates.

## Gemini

Standard synchronous pricing from [Google](https://ai.google.dev/gemini-api/docs/pricing). Text output includes billable thinking tokens; image output is metered separately.

| Model | Input | Text output | Image output |
| --- | --- | --- | --- |
| `gemini-2.5-flash-image` | $0.3 | $2.5 | $30 |
| `gemini-3-pro-image` | $2 | $12 | $120 |
| `gemini-3.1-flash-image` | $0.5 | $3 | $60 |
| `gemini-3.1-flash-lite-image` | $0.25 | $1.5 | $30 |

## Together

Together image routes are excluded because authenticated generation requests require the organization to enable third-party data sharing. This includes the 26 previously listed models and the three Imagen 4 routes. Their prices remain recorded internally, but they are absent from discovery and reject generation with `bad_request` before an upstream call. A sharing restriction does not establish model retirement.

## Cloudflare Workers AI

Prices come from the authenticated [Workers AI model search API](https://developers.cloudflare.com/api/resources/ai/subresources/models/methods/list/) and [Cloudflare pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). SDXL Lightning, SDXL Base, and Inpainting explicitly report a zero-dollar step rate. Other account quotas still apply.

| Model | Rate |
| --- | --- |
| `@cf/bytedance/stable-diffusion-xl-lightning` | $0 per step |
| `@cf/stabilityai/stable-diffusion-xl-base-1.0` | $0 per step |
| `@cf/runwayml/stable-diffusion-v1-5-inpainting` | $0 per step |
| `@cf/black-forest-labs/flux-1-schnell` | $0.0000528 per output tile; $0.0001056 per step |
| `@cf/leonardo/lucid-origin` | $0.007 per output tile; $0.000132 per step |
| `@cf/leonardo/phoenix-1.0` | $0.00583 per output tile; $0.00011 per step |
| `@cf/black-forest-labs/flux-2-dev` | $0.00021 per input tile per step; $0.00041 per output tile per step |
| `@cf/black-forest-labs/flux-2-klein-4b` | $0.000059 per input tile; $0.000287 per output tile |
| `@cf/black-forest-labs/flux-2-klein-9b` | $0.015 for the first output MP; $0.002 per additional output MP; $0.002 per input MP |

## xAI

Prices come from the authenticated image-generation model API and [xAI pricing](https://docs.x.ai/developers/pricing). Output rates are per image; media input is charged for each reference image.

| Model | Rate |
| --- | --- |
| `grok-imagine-image` | 1k: $0.02; 2k: $0.02; Each reference: $0.002 |
| `grok-imagine-image-quality` | 1k: $0.05; 2k: $0.07; Each reference: $0.01 |
| `grok-imagine-image-2.0` | 1k / low: $0.04; 2k / low: $0.06; 1k / medium: $0.06; 2k / medium: $0.08; Each reference: $0.01 |

## BytePlus

Prices come from [ModelArk pricing](https://docs.byteplus.com/en/docs/ModelArk/1544106). Seedream 5.0 Pro includes the first reference image; each additional reference costs $0.003. Its output rate is $0.045 through 2,610,000 pixels and $0.09 above that threshold.

| Model | Output image |
| --- | --- |
| `dola-seedream-5-0-pro-260628` | 1k: $0.045; 1.5k: $0.045; 2k: $0.09 |
| `seedream-5-0-lite-260128` | $0.035 |
| `seedream-4-5-251128` | $0.04 |
| `seedream-4-0-250828` | $0.03 |

## Replicate

Models were discovered through Replicate's authenticated text-to-image and FLUX collections and individual model APIs. Replicate omits prices from those responses, so each row links to its model's published billing schedule. Rates for community models are per second, rather than an estimated price for an example image. All entries below can be selected with the `replicate:` prefix shown.

Some entries perform editing, control-guided generation, style transfer, or custom workflows. Supply the required reference, mask or workflow through the [Replicate options](/AI/txt2img#replicate-options). Each call returns one image. Model-specific fields are accepted through `providerOptions`; common image options take precedence.

| Model | Rate | Source |
| --- | --- | --- |
| `replicate:black-forest-labs/flux-2-pro` | $0.015 per run + $0.015 per input MP + $0.015 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-pro#pricing) |
| `replicate:black-forest-labs/flux-2-dev` | $0.014 per input MP + $0.014 per output MP; go_fast=true: $0.012 per input MP + $0.012 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-dev#pricing) |
| `replicate:black-forest-labs/flux-2-klein-9b-base` | $0.011 per input MP + $0.011 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-klein-9b-base#pricing) |
| `replicate:black-forest-labs/flux-2-klein-4b` | $0.001 per input MP + $0.001 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-klein-4b#pricing) |
| `replicate:black-forest-labs/flux-schnell` | $0.003 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-schnell#pricing) |
| `replicate:black-forest-labs/flux-1.1-pro` | $0.04 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-1.1-pro#pricing) |
| `replicate:leonardoai/lucid-origin` | $0.0167 per output image; standard: $0.0167 per output image; ultra: $0.0765 per output image | [Pricing](https://replicate.com/leonardoai/lucid-origin#pricing) |
| `replicate:adirik/realvisxl-v3.0-turbo` | $0.000975 per second | [Pricing](https://replicate.com/adirik/realvisxl-v3.0-turbo#pricing) |
| `replicate:ai-forever/kandinsky-2.2` | $0.0014 per second | [Pricing](https://replicate.com/ai-forever/kandinsky-2.2#pricing) |
| `replicate:ai-forever/kandinsky-2` | $0.0014 per second | [Pricing](https://replicate.com/ai-forever/kandinsky-2#pricing) |
| `replicate:black-forest-labs/flux-1.1-pro-ultra` | $0.06 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-1.1-pro-ultra#pricing) |
| `replicate:black-forest-labs/flux-2-flex` | $0.06 per input MP + $0.06 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-flex#pricing) |
| `replicate:black-forest-labs/flux-2-max` | $0.04 per run + $0.03 per input MP + $0.03 per output MP | [Pricing](https://replicate.com/black-forest-labs/flux-2-max#pricing) |
| `replicate:black-forest-labs/flux-canny-dev` | $0.025 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-canny-dev#pricing) |
| `replicate:black-forest-labs/flux-canny-pro` | $0.05 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-canny-pro#pricing) |
| `replicate:black-forest-labs/flux-depth-dev` | $0.025 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-depth-dev#pricing) |
| `replicate:black-forest-labs/flux-depth-pro` | $0.05 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-depth-pro#pricing) |
| `replicate:black-forest-labs/flux-dev-lora` | $0.032 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-dev-lora#pricing) |
| `replicate:black-forest-labs/flux-dev` | $0.025 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-dev#pricing) |
| `replicate:black-forest-labs/flux-fill-dev` | $0.04 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-fill-dev#pricing) |
| `replicate:black-forest-labs/flux-fill-pro` | $0.05 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-fill-pro#pricing) |
| `replicate:black-forest-labs/flux-kontext-max` | $0.08 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-kontext-max#pricing) |
| `replicate:black-forest-labs/flux-kontext-pro` | $0.04 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-kontext-pro#pricing) |
| `replicate:black-forest-labs/flux-pro` | $0.055 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-pro#pricing) |
| `replicate:black-forest-labs/flux-redux-dev` | $0.025 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-redux-dev#pricing) |
| `replicate:black-forest-labs/flux-redux-schnell` | $0.003 per output image | [Pricing](https://replicate.com/black-forest-labs/flux-redux-schnell#pricing) |
| `replicate:bria/fibo` | $0.04 per output image | [Pricing](https://replicate.com/bria/fibo#pricing) |
| `replicate:bria/image-3.2` | $0.04 per output image | [Pricing](https://replicate.com/bria/image-3.2#pricing) |
| `replicate:bytedance/sdxl-lightning-4step` | $0.0014 per second | [Pricing](https://replicate.com/bytedance/sdxl-lightning-4step#pricing) |
| `replicate:bytedance/seedream-4.5` | $0.04 per output image | [Pricing](https://replicate.com/bytedance/seedream-4.5#pricing) |
| `replicate:bytedance/seedream-4` | $0.03 per output image | [Pricing](https://replicate.com/bytedance/seedream-4#pricing) |
| `replicate:bytedance/seedream-5-lite` | $0.035 per output image | [Pricing](https://replicate.com/bytedance/seedream-5-lite#pricing) |
| `replicate:comfyui/any-comfyui-workflow` | $0.000975 per second | [Pricing](https://replicate.com/comfyui/any-comfyui-workflow#pricing) |
| `replicate:datacte/proteus-v0.2` | $0.000975 per second | [Pricing](https://replicate.com/datacte/proteus-v0.2#pricing) |
| `replicate:datacte/proteus-v0.3` | $0.000975 per second | [Pricing](https://replicate.com/datacte/proteus-v0.3#pricing) |
| `replicate:fermatresearch/sdxl-controlnet-lora` | $0.000975 per second | [Pricing](https://replicate.com/fermatresearch/sdxl-controlnet-lora#pricing) |
| `replicate:fofr/latent-consistency-model` | $0.0014 per second | [Pricing](https://replicate.com/fofr/latent-consistency-model#pricing) |
| `replicate:fofr/sdxl-emoji` | $0.000975 per second | [Pricing](https://replicate.com/fofr/sdxl-emoji#pricing) |
| `replicate:fofr/sdxl-multi-controlnet-lora` | $0.000975 per second | [Pricing](https://replicate.com/fofr/sdxl-multi-controlnet-lora#pricing) |
| `replicate:fofr/sticker-maker` | $0.000975 per second | [Pricing](https://replicate.com/fofr/sticker-maker#pricing) |
| `replicate:google/nano-banana-2` | resolution=1K: $0.067 per output image; resolution=2K: $0.101 per output image; resolution=4K: $0.151 per output image | [Pricing](https://replicate.com/google/nano-banana-2#pricing) |
| `replicate:google/nano-banana-pro` | resolution=1K: $0.15 per output image; resolution=2K: $0.15 per output image; resolution=4K: $0.3 per output image | [Pricing](https://replicate.com/google/nano-banana-pro#pricing) |
| `replicate:google/nano-banana` | $0.039 per output image | [Pricing](https://replicate.com/google/nano-banana#pricing) |
| `replicate:ideogram-ai/ideogram-v2-turbo` | $0.05 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v2-turbo#pricing) |
| `replicate:ideogram-ai/ideogram-v2` | $0.08 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v2#pricing) |
| `replicate:ideogram-ai/ideogram-v2a-turbo` | $0.025 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v2a-turbo#pricing) |
| `replicate:ideogram-ai/ideogram-v2a` | $0.04 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v2a#pricing) |
| `replicate:ideogram-ai/ideogram-v3-balanced` | $0.06 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v3-balanced#pricing) |
| `replicate:ideogram-ai/ideogram-v3-quality` | $0.09 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v3-quality#pricing) |
| `replicate:ideogram-ai/ideogram-v3-turbo` | $0.03 per output image | [Pricing](https://replicate.com/ideogram-ai/ideogram-v3-turbo#pricing) |
| `replicate:jagilley/controlnet-scribble` | $0.0014 per second | [Pricing](https://replicate.com/jagilley/controlnet-scribble#pricing) |
| `replicate:lucataco/dreamshaper-xl-turbo` | $0.000975 per second | [Pricing](https://replicate.com/lucataco/dreamshaper-xl-turbo#pricing) |
| `replicate:lucataco/open-dalle-v1.1` | $0.000975 per second | [Pricing](https://replicate.com/lucataco/open-dalle-v1.1#pricing) |
| `replicate:lucataco/realistic-vision-v5.1` | $0.000975 per second | [Pricing](https://replicate.com/lucataco/realistic-vision-v5.1#pricing) |
| `replicate:lucataco/ssd-1b` | $0.000975 per second | [Pricing](https://replicate.com/lucataco/ssd-1b#pricing) |
| `replicate:luma/photon-flash` | $0.01 per output image | [Pricing](https://replicate.com/luma/photon-flash#pricing) |
| `replicate:luma/photon` | $0.03 per output image | [Pricing](https://replicate.com/luma/photon#pricing) |
| `replicate:minimax/image-01` | $0.01 per output image | [Pricing](https://replicate.com/minimax/image-01#pricing) |
| `replicate:nvidia/sana-sprint-1.6b` | $0.001525 per second | [Pricing](https://replicate.com/nvidia/sana-sprint-1.6b#pricing) |
| `replicate:nvidia/sana` | $0.001525 per second | [Pricing](https://replicate.com/nvidia/sana#pricing) |
| `replicate:openai/gpt-image-1.5` | quality=auto: $0.136 per output image; quality=low: $0.013 per output image; quality=medium: $0.05 per output image; quality=high: $0.136 per output image | [Pricing](https://replicate.com/openai/gpt-image-1.5#pricing) |
| `replicate:openai/gpt-image-2` | quality=auto: $0.128 per output image; quality=low: $0.012 per output image; quality=medium: $0.047 per output image; quality=high: $0.128 per output image | [Pricing](https://replicate.com/openai/gpt-image-2#pricing) |
| `replicate:playgroundai/playground-v2.5-1024px-aesthetic` | $0.0014 per second | [Pricing](https://replicate.com/playgroundai/playground-v2.5-1024px-aesthetic#pricing) |
| `replicate:prunaai/flux-fast` | $0.005 per output image | [Pricing](https://replicate.com/prunaai/flux-fast#pricing) |
| `replicate:prunaai/hidream-l1-dev` | $0.001525 per second | [Pricing](https://replicate.com/prunaai/hidream-l1-dev#pricing) |
| `replicate:prunaai/hidream-l1-full` | $0.001525 per second | [Pricing](https://replicate.com/prunaai/hidream-l1-full#pricing) |
| `replicate:prunaai/p-image-lora` | $0.005 per output image | [Pricing](https://replicate.com/prunaai/p-image-lora#pricing) |
| `replicate:prunaai/p-image` | $0.005 per output image | [Pricing](https://replicate.com/prunaai/p-image#pricing) |
| `replicate:prunaai/sdxl-lightning` | $0.0014 per second | [Pricing](https://replicate.com/prunaai/sdxl-lightning#pricing) |
| `replicate:prunaai/wan-2.2-image` | $0.02 per output image | [Pricing](https://replicate.com/prunaai/wan-2.2-image#pricing) |
| `replicate:prunaai/z-image-turbo` | megapixels=0.5: $0.0025 per output MP; megapixels=1: $0.005 per output MP; megapixels=2: $0.01 per output MP; megapixels=3: $0.015 per output MP; megapixels=4: $0.02 per output MP | [Pricing](https://replicate.com/prunaai/z-image-turbo#pricing) |
| `replicate:qwen/qwen-image` | $0.025 per output image | [Pricing](https://replicate.com/qwen/qwen-image#pricing) |
| `replicate:recraft-ai/recraft-v3-svg` | $0.08 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v3-svg#pricing) |
| `replicate:recraft-ai/recraft-v3` | $0.04 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v3#pricing) |
| `replicate:recraft-ai/recraft-v4-pro-svg` | $0.3 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v4-pro-svg#pricing) |
| `replicate:recraft-ai/recraft-v4-pro` | $0.25 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v4-pro#pricing) |
| `replicate:recraft-ai/recraft-v4-styles-pro-svg` | $0.12 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v4-styles-pro-svg#pricing) |
| `replicate:recraft-ai/recraft-v4-svg` | $0.08 per output image | [Pricing](https://replicate.com/recraft-ai/recraft-v4-svg#pricing) |
| `replicate:sdxl-based/realvisxl-v3-multi-controlnet-lora` | $0.000975 per second | [Pricing](https://replicate.com/sdxl-based/realvisxl-v3-multi-controlnet-lora#pricing) |
| `replicate:sourceful/riverflow-2.0-pro` | resolution=1K: $0.15 per output image + $0.03 per font; resolution=2K: $0.15 per output image + $0.03 per font; resolution=4K: $0.33 per output image + $0.03 per font | [Pricing](https://replicate.com/sourceful/riverflow-2.0-pro#pricing) |
| `replicate:stability-ai/sdxl` | $0.000975 per second | [Pricing](https://replicate.com/stability-ai/sdxl#pricing) |
| `replicate:stability-ai/stable-diffusion-3.5-large-turbo` | $0.04 per output image | [Pricing](https://replicate.com/stability-ai/stable-diffusion-3.5-large-turbo#pricing) |
| `replicate:stability-ai/stable-diffusion-3.5-large` | $0.065 per output image | [Pricing](https://replicate.com/stability-ai/stable-diffusion-3.5-large#pricing) |
| `replicate:stability-ai/stable-diffusion-3.5-medium` | $0.035 per output image | [Pricing](https://replicate.com/stability-ai/stable-diffusion-3.5-medium#pricing) |
| `replicate:stability-ai/stable-diffusion` | $0.0014 per second | [Pricing](https://replicate.com/stability-ai/stable-diffusion#pricing) |
| `replicate:tencent/hunyuan-image-3` | $0.08 per output image | [Pricing](https://replicate.com/tencent/hunyuan-image-3#pricing) |
| `replicate:tstramer/material-diffusion` | $0.0014 per second | [Pricing](https://replicate.com/tstramer/material-diffusion#pricing) |
| `replicate:wan-video/wan-2.7-image-pro` | $0.03 per output image | [Pricing](https://replicate.com/wan-video/wan-2.7-image-pro#pricing) |
| `replicate:wan-video/wan-2.7-image` | $0.03 per output image | [Pricing](https://replicate.com/wan-video/wan-2.7-image#pricing) |
| `replicate:xai/grok-imagine-image` | $0.02 per output image | [Pricing](https://replicate.com/xai/grok-imagine-image#pricing) |

Riverflow 2.0 Pro includes up to two font references at $0.03 each. Nano Banana Pro's optional fallback model is disabled because it has a different billing schedule. See [rate limits and quotas](/rate-limits-and-quotas#image-generation) for request caps.

## Data use

Routes identified as requiring customer-content training or a third-party data-sharing opt-in are excluded from discovery, pricing discovery, and generation. Exclusions apply to provider routes: another provider's independently permitted route can remain available. Explicitly selecting an excluded route fails with `bad_request`, including in test mode; it does not silently select another provider. Temporary processing, output delivery, and abuse-monitoring retention are separate from this exclusion rule.

Provider data-use policies still apply to retained routes. [OpenAI API content](https://developers.openai.com/api/docs/guides/your-data) and [xAI API content](https://docs.x.ai/developers/faq/security) are not used for training without opt-in. [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/platform/data-usage/) requires consent for training or service improvement. [BytePlus ModelArk](https://docs.byteplus.com/en/docs/legal/docs-service-specific-terms) requires a separate training opt-in. Keep optional training or data-collaboration programs disabled.

For [Gemini](https://ai.google.dev/gemini-api/terms), use a project with active paid billing: unpaid-service terms can allow product and model improvement using prompts and responses. The image catalog does not inspect account-level consent or billing settings. [Replicate](https://replicate.com/terms) distinguishes models hosted by Replicate from externally hosted marketplace models; its model-specific terms also apply. Retention badges and successful API calls alone do not establish the absence of third-party processing.

## Excluded models

Replicate `leonardoai/phoenix-1.0`, `bytedance/seedream-3`, `black-forest-labs/flux-pro-finetuned`, `quiverai/arrow-1.1`, `quiverai/arrow-1.1-max`, and `prunaai/hidream-l1-fast` have published prices but are disabled after repeated upstream generation failures, including minimal requests for Quiver and read timeouts on HiDream Fast. Their schemas and rates remain recorded for re-enabling after the upstream service recovers.

Replicate Imagen 3/4 entries are excluded after upstream 404s and Google's [endpoint retirement notice](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/4-0-generate). Together Imagen 4 entries are excluded for required third-party data sharing; their retirement through Together has not been confirmed.

Cloudflare Dreamshaper and BytePlus `seedream-4-0-20260415` were discoverable and generated images, but neither the model API nor a provider page supplied a price for those exact entries. They are excluded until a rate is published. Retired or shut-down models are also excluded; upcoming retirement dates for retained compatibility models are listed in the [availability notes](/AI/txt2img#providers-and-model-discovery).
