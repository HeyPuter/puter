---
title: puter.ai.txt2vid()
description: Generate short-form videos with AI models through Puter.js.
platforms: [websites, apps, nodejs, workers]
---

Create AI-generated video clips directly from text prompts.

## Syntax

```js
puter.ai.txt2vid(prompt, testMode = false)
puter.ai.txt2vid(prompt, options = {})
puter.ai.txt2vid({prompt, ...options})
```

## Parameters

#### `prompt` (String) (required)

The text description that guides the video generation.

#### `testMode` (Boolean) (optional)

When `true`, the call returns a sample video so you can test your UI without incurring usage. Defaults to `false`.

#### `options` (Object) (optional)

Additional settings for the generation request. Available options depend on the provider.

| Option | Type | Description |
|--------|------|-------------|
| `prompt` | `String` | Text description for the video generation |
| `provider` | `String` | The AI provider to use. `'openai' (default) \| 'together'` |
| `model` | `String` | Video model to use (provider-specific). Defaults to `'sora-2'` |
| `seconds` | `Number` | Target clip length in seconds |
| `test_mode` | `Boolean` | When `true`, returns a sample video without using credits |

#### OpenAI Options

Available when `provider: 'openai'` or inferred from model (`sora-2`, `sora-2-pro`):

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use. Available: `'sora-2'`, `'sora-2-pro'` |
| `seconds` | `Number` | Target clip length in seconds. Available: `4`, `8`, `12` |
| `size` | `String` | Output resolution (e.g., `'720x1280'`, `'1280x720'`, `'1024x1792'`, `'1792x1024'`). `resolution` is an alias |
| `input_reference` | `File` | Optional image reference that guides generation. |

For more details about each option, see the [OpenAI API reference](https://platform.openai.com/docs/api-reference/videos/create).

#### TogetherAI Options

Available when `provider: 'together'` or inferred from model:

| Option | Type | Description |
|--------|------|-------------|
| `width` | `Number` | Output video width in pixels |
| `height` | `Number` | Output video height in pixels |
| `fps` | `Number` | Frames per second |
| `steps` | `Number` | Number of inference steps |
| `guidance_scale` | `Number` | How closely to follow the prompt |
| `seed` | `Number` | Random seed for reproducible results |
| `output_format` | `String` | Output format for the video |
| `output_quality` | `Number` | Quality level of the output |
| `negative_prompt` | `String` | Text describing what to avoid in the video |
| `reference_images` | `Array<String>` | Reference images to guide the generation |
| `frame_images` | `Array<Object>` | Frame images for video-to-video generation. Each object has `input_image` (`String` - image URL) and `frame` (`Number` - frame index) |
| `metadata` | `Object` | Additional metadata for the request |

For more details about each option, see the [TogetherAI API reference](https://docs.together.ai/reference/create-videos).

Any properties not set fall back to provider defaults.

## Return value

A `Promise` that resolves to an `HTMLVideoElement`. The element is preloaded, has `controls` enabled, and exposes metadata via `data-mime-type` and `data-source` attributes. Append it to the DOM to display the generated clip immediately.

> **Note:** Real Sora renders can take a couple of minutes to complete. The returned promise resolves only when the MP4 is ready, so keep your UI responsive (for example, by showing a spinner) while you wait. Each successful generation consumes the user’s AI credits in accordance with the model, duration, and resolution you request.

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

<strong class="example-title">Generate an 8-second cinematic clip</strong>

```html;ai-txt2vid-options
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid("A fox sprinting through a snow-covered forest at dusk", {
            model: "sora-2-pro",
            seconds: 8,
            size: "1280x720"
        }).then((video) => {
            document.body.appendChild(video);
            // Autoplay once metadata is available
            video.addEventListener('loadeddata', () => video.play().catch(() => {}));
        }).catch(console.error);
    </script>
</body>
</html>
```
