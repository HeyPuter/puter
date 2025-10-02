Converts text into speech using AI. Supports multiple languages and voices.

## Syntax

```js
puter.ai.txt2speech(text)
puter.ai.txt2speech(text, options)
puter.ai.txt2speech(text, language)
puter.ai.txt2speech(text, language, voice)
puter.ai.txt2speech(text, language, voice, engine)
```

## Parameters
#### `text` (String) (required)
A string containing the text you want to convert to speech. The text must be less than 3000 characters long.

#### `options` (Object) (optional)
An object containing the following optional properties:

- `language` (String): The language to use for speech synthesis. Defaults to `en-US`.
- `voice` (String): The voice to use for speech synthesis. Defaults to `Joanna`.
- `engine` (String): The speech synthesis engine to use. Can be `standard`, `neural`, or `generative`. Defaults to `standard`.

#### `language` (String) (optional)
The language to use for speech synthesis. Defaults to `en-US`. The following languages are supported:

- Arabic (`ar-AE`)
- Catalan (`ca-ES`)
- Chinese (Cantonese) (`yue-CN`)
- Chinese (Mandarin) (`cmn-CN`)
- Danish (`da-DK`)
- Dutch (Belgian) (`nl-BE`)
- Dutch (`nl-NL`)
- English (Australian) (`en-AU`)
- English (British) (`en-GB`)
- English (Indian) (`en-IN`)
- English (New Zealand) (`en-NZ`)
- English (South African) (`en-ZA`)
- English (US) (`en-US`)
- English (Welsh) (`en-GB-WLS`)
- Finnish (`fi-FI`)
- French (`fr-FR`)
- French (Belgian) (`fr-BE`)
- French (Canadian) (`fr-CA`)
- German (`de-DE`)
- German (Austrian) (`de-AT`)
- Hindi (`hi-IN`)
- Icelandic (`is-IS`)
- Italian (`it-IT`)
- Japanese (`ja-JP`)
- Korean (`ko-KR`)
- Norwegian (`nb-NO`)
- Polish (`pl-PL`)
- Portuguese (Brazilian) (`pt-BR`)
- Portuguese (European) (`pt-PT`)
- Romanian (`ro-RO`)
- Russian (`ru-RU`)
- Spanish (European) (`es-ES`)
- Spanish (Mexican) (`es-MX`)
- Spanish (US) (`es-US`)
- Swedish (`sv-SE`)
- Turkish (`tr-TR`)
- Welsh (`cy-GB`)

#### `voice` (String) (optional)
The voice to use for speech synthesis. Defaults to `Joanna`. Please refer to the [voices documentation](https://docs.aws.amazon.com/polly/latest/dg/available-voices.html) for a list of available voices and their corresponding language codes.

#### `engine` (String) (optional)
The speech synthesis engine to use. Can be `standard`, `neural`, or `generative`. Defaults to `standard`. Neural voices generally provide higher quality speech synthesis but may have usage limitations.

## Return value
A `Promise` that will resolve to an MP3 stream when the speech has been synthesized.

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