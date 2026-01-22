---
title: puter.ai.speech2txt()
description: Transcribe or translate audio into text using OpenAI speech-to-text models.
platforms: [websites, apps, nodejs, workers]
---

Converts spoken audio into text with optional English translation and diarization support. This helper wraps the Puter driver-backed OpenAI transcription API so you can work with local files, remote URLs, or in-memory blobs from the browser.

## Syntax

```js
puter.ai.speech2txt(source, testMode = false)
puter.ai.speech2txt(source, options, testMode = false)
puter.ai.speech2txt({ audio: source, ...options })
```

## Parameters

#### `source` (String | File | Blob) (required unless provided in options)

Audio to transcribe. Accepts:

- A Puter path such as `~/Desktop/meeting.mp3`
- A data URL (`data:audio/wav;base64,...`)
- A `File` or `Blob` object (converted to data URL automatically)
- A remote HTTPS URL

When you omit `source`, supply `options.file` or `options.audio` instead.

#### `options` (Object) (optional)

Fine-tune how transcription runs.

- `file` / `audio` (String | File | Blob): Alternative way to pass the audio input.
- `model` (String): One of `gpt-4o-mini-transcribe`, `gpt-4o-transcribe`, `gpt-4o-transcribe-diarize`, `whisper-1`, or any future backend-supported model. Defaults to `gpt-4o-mini-transcribe` for transcription and `whisper-1` for translation.
- `translate` (Boolean): Set to `true` to force English output (uses the translations endpoint).
- `response_format` (String): Desired output shape. Examples: `json`, `text`, `diarized_json`, `srt`, `verbose_json`, `vtt` (depends on the model).
- `language` (String): ISO language code hint for the input audio.
- `prompt` (String): Optional context for models that support prompting (all except `gpt-4o-transcribe-diarize`).
- `temperature` (Number): Sampling temperature (0–1) for supported models.
- `logprobs` (Boolean): Request token log probabilities where supported.
- `timestamp_granularities` (Array\<String>): Include `segment` or `word` level timestamps on models that offer them (currently `whisper-1`).
- `chunking_strategy` (String): Required for `gpt-4o-transcribe-diarize` inputs longer than 30 seconds (recommend `"auto"`).
- `known_speaker_names` / `known_speaker_references` (Array): Optional diarization references encoded as data URLs.
- `extra_body` (Object): Forwarded verbatim to the OpenAI API for experimental flags.
- `stream` (Boolean): Reserved for future streaming support. Currently rejected when `true`.
- `test_mode` (Boolean): When `true`, returns a sample response without using credits. Defaults to `false`.

#### `testMode` (Boolean) (optional)

When `true`, skips the live API call and returns a static sample transcript so you can develop without consuming credits.

## Return value

Returns a `Promise` that resolves to either:

- A string (when `response_format: "text"` or you pass a shorthand `source` with no options), or
- An object of [`Speech2TxtResult`](/Objects/speech2txtresult) containing the transcription payload (including diarization segments, timestamps, etc., depending on the selected model and format).

## Examples

<strong class="example-title">Transcribe a file</strong>

```html;ai-speech2txt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const transcript = await puter.ai.speech2txt('https://assets.puter.site/example.mp3');
            puter.print('Transcript:', transcript.text ?? transcript);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Translate to English with diarization</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const meeting = await puter.ai.speech2txt({
                file: '~/test.mp3',
                translate: true,
                model: 'gpt-4o-transcribe-diarize',
                response_format: 'diarized_json',
                chunking_strategy: 'auto'
            });

            meeting.segments.forEach(segment => {
                console.log(`${segment.speaker}: ${segment.text}`);
            });
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Use test mode during development</strong>

```html
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const sample = await puter.ai.speech2txt('~/test.mp3', true);
            console.log('Sample output:', sample.text);
        })();
    </script>
</body>
</html>
```
