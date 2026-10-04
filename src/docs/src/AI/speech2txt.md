---
title: puter.ai.speech2txt()
description: Transcribe audio into text using OpenAI or xAI speech-to-text models.
platforms: [websites, apps, nodejs, workers]
---

Converts spoken audio into text, with speaker diarization on xAI. This helper wraps the Puter driver-backed transcription API (OpenAI and xAI) so you can work with local files, remote URLs, or in-memory blobs from the browser.

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
- `provider` (String): STT provider to use. `'openai'` (default) or `'xai'`. Aliases `'whisper'`, `'grok'` and `'x-ai'` are also accepted; anything else is rejected with a `bad_request` error.
- `model` (String): `gpt-transcribe` (OpenAI default), or `grok-voice-transcribe-2.0` with `provider: 'xai'`. OpenAI deprecated `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, and `gpt-4o-transcribe-diarize`; Puter rejects them with `bad_request`.
- `translate` (Boolean): Not supported. On OpenAI, `translate: true` fails with `bad_request`; on xAI it returns an ordinary transcript in the source language.
- `response_format` (String): `json` (default) or `text` for OpenAI.
- `language` (String): ISO language code hint for the input audio.
- `prompt` (String): Optional context to guide the transcription.
- `temperature` (Number): Sampling temperature (0–1) for supported models.
- `logprobs` (Boolean): Request token log probabilities where supported.
- `extra_body` (Object): Forwarded verbatim to the OpenAI API for experimental flags.
- `stream` (Boolean): Reserved for future streaming support. Streaming is not currently supported.
- `test_mode` (Boolean): When `true`, returns a sample response without using credits. Defaults to `false`.

**xAI-specific options** (when `provider: 'xai'`):

- `language` (String): Language code (e.g. `en`, `fr`). Enables text formatting when `format` is `true`.
- `format` (Boolean): When `true`, enables Inverse Text Normalization (numbers/currency to written form). Requires `language`.
- `diarize` (Boolean): When `true`, words include a `speaker` field identifying the detected speaker.
- `multichannel` (Boolean): When `true`, transcribes each audio channel independently.
- `channels` (Number): Number of audio channels (2–8). Required for multichannel raw audio.
- `audio_format` (String): Format hint for raw/headerless audio: `pcm`, `mulaw`, `alaw`.
- `sample_rate` (Number): Sample rate in Hz. Required for raw audio.

#### `testMode` (Boolean) (optional)

When `true`, skips the live API call and returns a static sample transcript so you can develop without consuming credits.

## Return value

Returns a `Promise` that resolves to either:

- A string (when `response_format: "text"`), or
- An object of [`Speech2TxtResult`](/Objects/speech2txtresult) containing the transcription payload (including per-word timestamps and speakers on xAI, depending on the provider and options). This is the default, including when you pass a bare `source` with no options.

## Examples

<strong class="example-title">Transcribe a file</strong>

```html;ai-speech2txt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const transcript = await puter.ai.speech2txt('https://assets.puter.site/example.mp3');
            puter.print('Transcript:', transcript.text);
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Transcribe with xAI (Grok)</strong>

```html;ai-speech2txt-xai
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        (async () => {
            const transcript = await puter.ai.speech2txt({
                file: 'https://assets.puter.site/example.mp3',
                provider: 'xai',
                language: 'en',
                format: true
            });
            puter.print('Transcript:', transcript.text);
            puter.print('Duration:', transcript.duration + 's');
            if (transcript.words) {
                transcript.words.forEach(w => {
                    puter.print(`  ${w.start.toFixed(2)}s - ${w.end.toFixed(2)}s: ${w.text}`);
                });
            }
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
