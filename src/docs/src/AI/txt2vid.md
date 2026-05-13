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
| `model` | `String` | Video model to use (provider-specific). Defaults to `'sora-2'` |
| `seconds` | `Number` | Target clip length in seconds |
| `test_mode` | `Boolean` | When `true`, returns a sample video without using credits |
| `puter_output_path` | `String` | When set, the generated video is automatically saved to this path on the Puter filesystem. Relative paths are resolved against the app's data directory (or `~/` outside an app). The caller must have write permission to the destination |

#### OpenAI Options

Available when using model `sora-2` or `sora-2-pro`:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use. Available: `'sora-2'`, `'sora-2-pro'` |
| `seconds` | `Number` | Target clip length in seconds. Available: `4`, `8`, `12` |
| `size` | `String` | Output resolution (e.g., `'720x1280'`, `'1280x720'`, `'1024x1792'`, `'1792x1024'`). `resolution` is an alias |
| `input_reference` | `File` | Optional image reference that guides generation. |

For more details about each option, see the [OpenAI API reference](https://platform.openai.com/docs/api-reference/videos/create).

#### Google (Veo) Options

Available when using a Veo model (`veo-2.0-generate-001`, `veo-3.0-generate-001`, `veo-3.1-generate-preview`, etc.):

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | Video model to use. Available: `'veo-2.0-generate-001'`, `'veo-3.0-generate-001'`, `'veo-3.0-fast-generate-001'`, `'veo-3.1-generate-preview'`, `'veo-3.1-fast-generate-preview'`, `'veo-3.1-lite-generate-preview'` |
| `seconds` | `Number` | Target clip length in seconds. Veo 2.0: `5`, `6`, `8`. Veo 3.x: `4`, `6`, `8`. Note: 1080p and 4K output require `seconds: 8` |
| `size` | `String` | Output dimensions (e.g., `'1280x720'`, `'1920x1080'`, `'3840x2160'`). `resolution` is an alias. 4K sizes only available on Veo 3.1 models |
| `negative_prompt` | `String` | Text describing what to avoid in the video |
| `input_reference` | `String` | Base64 image used as the first frame (image-to-video). |
| `reference_images` | `Array<String>` | Up to 3 base64 images used as style/asset references. Supported on Veo 3.1 models only |
| `last_frame` | `String` | Base64 image used as the last frame |

For more details, see the [Google Veo API reference](https://ai.google.dev/gemini-api/docs/video).

#### TogetherAI Options

Available when using a TogetherAI model:

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

#### Saving to Puter filesystem

Pass `puter_output_path` to persist the generated video directly on the Puter filesystem. Relative paths are resolved against `~/AppData/<appID>/` when called from an app, or `~/` otherwise:

```js
puter.ai.txt2vid("A drone shot over a forest", {
    puter_output_path: "videos/forest.mp4"  // saved to ~/AppData/<appID>/videos/forest.mp4
});
```

Absolute paths (`/username/Videos/forest.mp4`) and home-relative paths (`~/Videos/forest.mp4`) are sent as-is. Write permission to the destination is enforced server-side.

## Return value

A `Promise` that resolves to an `HTMLVideoElement`. The element is preloaded, has `controls` enabled, and exposes metadata via `data-mime-type` and `data-source` attributes. Append it to the DOM to display the generated clip immediately.

> **Note:** Video generation can take several minutes to complete. The returned promise resolves only when the video is ready, so keep your UI responsive (for example, by showing a spinner) while you wait. Each successful generation consumes the user’s AI credits in accordance with the model, duration, and resolution you request.

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
