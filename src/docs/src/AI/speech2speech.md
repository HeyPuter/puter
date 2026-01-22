---
title: puter.ai.speech2speech()
description: Transform an audio clip into a different voice using ElevenLabs speech-to-speech.
platforms: [websites, apps, nodejs, workers]
---

Convert an existing recording into another voice while preserving timing, pacing, and delivery. This helper wraps the ElevenLabs voice changer endpoint so you can swap voices locally, from remote URLs, or with in-memory blobs.

## Syntax

```js
puter.ai.speech2speech(source, testMode = false)
puter.ai.speech2speech(source, options, testMode = false)
puter.ai.speech2speech({ audio: source, ...options })
```

## Parameters

#### `source` (String | File | Blob) (required unless provided in options)

Audio to convert. Accepts:

- A Puter path such as `~/recordings/line-read.wav`
- A `File` or `Blob` (converted to data URL automatically)
- A data URL (`data:audio/wav;base64,...`)
- A remote HTTPS URL

#### `options` (Object) (optional)

Fine-tune the conversion:

- `audio` (String | File | Blob): Alternate way to provide the source input.
- `voice` (String): Target ElevenLabs voice ID. Defaults to the configured ElevenLabs voice (Rachel sample if unset).
- `model` (String): Voice-changer model. Defaults to `eleven_multilingual_sts_v2`. You can also use `eleven_english_sts_v2` for English-only inputs.
- `output_format` (String): Desired output codec and bitrate, e.g. `mp3_44100_128`, `opus_48000_64`, or `pcm_48000`. Defaults to `mp3_44100_128`.
- `voice_settings` (Object|String): ElevenLabs voice settings payload (e.g. `{"stability":0.5,"similarity_boost":0.75}`).
- `seed` (Number): Randomization seed for deterministic outputs.
- `remove_background_noise` (Boolean): Apply background noise removal.
- `file_format` (String): Input file format hint (e.g. `pcm_s16le_16`) for raw PCM streams.
- `optimize_streaming_latency` (Number): Latency optimization level (0–4) forwarded to ElevenLabs.
- `enable_logging` (Boolean): Forwarded to ElevenLabs to toggle zero-retention logging behavior.
- `test_mode` (Boolean): When `true`, returns a sample response without using credits. Defaults to `false`.

#### `testMode` (Boolean) (optional)

When `true`, skips the live API call and returns a sample audio clip so you can build UI without spending credits.

## Return value

A `Promise` that resolves to an `HTMLAudioElement`. Call `audio.play()` or use the element’s `src` URL to work with the generated voice clip.

## Examples

<strong class="example-title">Change the voice of a sample clip</strong>

```html;ai-speech2speech-url
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const audio = await puter.ai.speech2speech('https://assets.puter.site/example.mp3', {
                voice: '21m00Tcm4TlvDq8ikWAM',
            });
            audio.play();
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Convert a recording stored as a file</strong>

```html;ai-speech2speech-file
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <input type="file" id="input" accept="audio/*" />
    <button id="convert">Change voice</button>
    <audio id="player" controls></audio>
    <script>
        document.getElementById('convert').onclick = async () => {
            const file = document.getElementById('input').files[0];
            if (!file) return alert('Pick an audio file first.');

            const audio = await puter.ai.speech2speech(file, {
                voice: '21m00Tcm4TlvDq8ikWAM', // Rachel sample voice
                model: 'eleven_multilingual_sts_v2',
                output_format: 'mp3_44100_128',
                removeBackgroundNoise: true,
            });

            document.getElementById('player').src = audio.toString();
            audio.play();
        };
    </script>
</body>
</html>
```

<strong class="example-title">Develop with test mode</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const preview = await puter.ai.speech2speech('~/any-file.wav', true);
            console.log('Sample audio URL:', preview.toString());
        })();
    </script>
</body>
</html>
```
