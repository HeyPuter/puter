---
title: puter.ai.txt2speech()
description: Convert text to speech with AI using multiple languages, voices, and engine types.
platforms: [websites, apps, nodejs, workers]
---

Converts text into speech using AI. Supports multiple languages and voices.

## Syntax

```js
puter.ai.txt2speech(text, testMode = false)
puter.ai.txt2speech(text, options)
puter.ai.txt2speech(text, language, testMode = false)
puter.ai.txt2speech(text, language, voice, testMode = false)
puter.ai.txt2speech(text, language, voice, engine, testMode = false)
```

## Parameters

#### `text` (String) (required)

A string containing the text you want to convert to speech. The text must be less than 3000 characters long. Defaults to AWS Polly provider when no options are provided.

#### `testMode` (Boolean) (optional)

When `true`, the call returns a sample audio so you can perform tests without incurring usage. Defaults to `false`.

#### `options` (Object) (optional)

Additional settings for the generation request. Available options depend on the provider.

| Option | Type | Description |
|--------|------|-------------|
| `provider` | `String` | TTS provider to use. `'aws-polly'` (default), `'openai'`, `'elevenlabs'` |
| `model` | `String` | Model identifier (provider-specific) |
| `voice` | `String` | Voice ID used for synthesis (provider-specific) |
| `test_mode` | `Boolean` | When `true`, returns a sample audio without using credits |

#### AWS Polly Options

Available when `provider: 'aws-polly'` (default):

| Option | Type | Description |
|--------|------|-------------|
| `voice` | `String` | Voice ID. Defaults to `'Joanna'`. See [available voices](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) |
| `engine` | `String` | Synthesis engine. Available: `'standard'` (default), `'neural'`, `'long-form'`, `'generative'` |
| `language` | `String` | Language code. Defaults to `'en-US'`. See [supported languages](https://docs.aws.amazon.com/polly/latest/dg/supported-languages.html) |
| `ssml` | `Boolean` | When `true`, text is treated as SSML markup |

#### OpenAI Options

Available when `provider: 'openai'`:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | TTS model. Available: `'gpt-4o-mini-tts'` (default), `'tts-1'`, `'tts-1-hd'` |
| `voice` | `String` | Voice ID. Available: `'alloy'` (default), `'ash'`, `'ballad'`, `'coral'`, `'echo'`, `'fable'`, `'nova'`, `'onyx'`, `'sage'`, `'shimmer'` |
| `response_format` | `String` | Output format. Available: `'mp3'` (default), `'wav'`, `'opus'`, `'aac'`, `'flac'`, `'pcm'` |
| `instructions` | `String` | Additional guidance for voice style (tone, speed, mood, etc.) |

For more details about each option, see the [OpenAI TTS API reference](https://platform.openai.com/docs/api-reference/audio/createSpeech).

#### ElevenLabs Options

Available when `provider: 'elevenlabs'`:

| Option | Type | Description |
|--------|------|-------------|
| `model` | `String` | TTS model. Available: `'eleven_multilingual_v2'` (default), `'eleven_flash_v2_5'`, `'eleven_turbo_v2_5'`, `'eleven_v3'` |
| `voice` | `String` | Voice ID. Defaults to `'21m00Tcm4TlvDq8ikWAM'` (Rachel sample voice) |
| `output_format` | `String` | Output format. Defaults to `'mp3_44100_128'` |
| `voice_settings` | `Object` | Voice tuning options (stability, similarity boost, speed) |

For more details about each option, see the [ElevenLabs API reference](https://elevenlabs.io/docs/api-reference/text-to-speech).

## Return value

A `Promise` that resolves to an `HTMLAudioElement`. The element’s `src` points at a blob or remote URL containing the synthesized audio.

## Examples

<strong class="example-title">Convert text to speech (Shorthand)</strong>

```html;ai-txt2speech
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="play">Speak!</button>
    <script>
        document.getElementById('play').addEventListener('click', ()=>{
            puter.ai.txt2speech(`Hello world! Puter is pretty amazing, don't you agree?`).then((audio)=>{
                audio.play();
            });
        });
    </script>
</body>
</html>
```

<strong class="example-title">Convert text to speech using options</strong>

```html;ai-txt2speech-options
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="play">Speak with options!</button>
    <script>
        document.getElementById('play').addEventListener('click', ()=>{
            puter.ai.txt2speech(`Hello world! This is using a neural voice.`, {
                voice: "Joanna",
                engine: "neural",
                language: "en-US"
            }).then((audio)=>{
                audio.play();
            });
        });
    </script>
</body>
</html>
```

<strong class="example-title">Use OpenAI voices</strong>

```html;ai-txt2speech-openai
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="play">Use OpenAI voice</button>
    <script>
        document.getElementById('play').addEventListener('click', async ()=>{
            const audio = await puter.ai.txt2speech(
                "Hello! This sample uses the OpenAI alloy voice.",
                {
                    provider: "openai",
                    model: "gpt-4o-mini-tts",
                    voice: "alloy",
                    response_format: "mp3",
                    instructions: "Sound cheerful but not overly fast."
                }
            );
            audio.play();
        });
    </script>
</body>
</html>
```

<strong class="example-title">Use ElevenLabs voices</strong>

```html;ai-txt2speech-elevenlabs
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="play">Use ElevenLabs voice</button>
    <script>
        document.getElementById('play').addEventListener('click', async ()=>{
            const audio = await puter.ai.txt2speech(
                "Hello! This sample uses an ElevenLabs voice.",
                {
                    provider: "elevenlabs",
                    model: "eleven_multilingual_v2",
                    voice: "21m00Tcm4TlvDq8ikWAM",
                    output_format: "mp3_44100_128"
                }
            );
            audio.play();
        });
    </script>
</body>
</html>
```

<strong class="example-title">Compare different engines</strong>

```html;ai-txt2speech-engines
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
        textarea { width: 100%; height: 80px; margin: 10px 0; }
        button { margin: 5px; padding: 10px 15px; cursor: pointer; }
        .status { margin: 10px 0; padding: 5px; font-size: 14px; }
    </style>
</head>
<body>
    <script src="https://js.puter.com/v2/"></script>
    
    <h1>Text-to-Speech Engine Comparison</h1>
    
    <textarea id="text-input" placeholder="Enter text to convert to speech...">Hello world! This is a test of the text-to-speech engines.</textarea>
    
    <div>
        <button onclick="playAudio('standard')">Standard Engine</button>
        <button onclick="playAudio('neural')">Neural Engine</button>
        <button onclick="playAudio('generative')">Generative Engine</button>
    </div>
    
    <div id="status" class="status"></div>

    <script>
        const textInput = document.getElementById('text-input');
        const statusDiv = document.getElementById('status');
        
        async function playAudio(engine) {
            const text = textInput.value.trim();
            
            if (!text) {
                statusDiv.textContent = 'Please enter some text first!';
                return;
            }
            
            if (text.length > 3000) {
                statusDiv.textContent = 'Text must be less than 3000 characters!';
                return;
            }
            
            statusDiv.textContent = `Converting with ${engine} engine...`;
            
            try {
                const audio = await puter.ai.txt2speech(text, {
                    voice: "Joanna",
                    engine: engine,
                    language: "en-US"
                });
                
                statusDiv.textContent = `Playing ${engine} audio`;
                audio.play();
            } catch (error) {
                statusDiv.textContent = `Error: ${error.message}`;
            }
        }
    </script>
</body>
</html>
```
