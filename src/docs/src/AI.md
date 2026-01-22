---
title: AI
description: Add artificial intelligence capabilities to your applications with Puter.js AI feature.
---

The Puter.js AI feature allows you to integrate artificial intelligence capabilities into your applications.

You can use AI models from various providers to perform tasks such as chat, text-to-image, image-to-text, text-to-video, and text-to-speech conversion. And with the [User-Pays Model](/user-pays-model/), you don't have to set up your own API keys and top up credits, because users cover their own AI costs.

## Features

<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="ai-chat"><span>AI Chat</span></div>
    <div class="example-group" data-section="text-to-image"><span>Text to Image</span></div>
    <div class="example-group" data-section="image-to-text"><span>Image to Text</span></div>
    <div class="example-group" data-section="text-to-speech"><span>Text to Speech</span></div>
    <div class="example-group" data-section="voice-changer"><span>Voice Changer</span></div>
    <div class="example-group" data-section="text-to-video"><span>Text to Video</span></div>
    <div class="example-group" data-section="speech-to-speech"><span>Speech to Speech</span></div>
    <div class="example-group" data-section="speech-to-text"><span>Speech to Text</span></div>
</div>

<div class="example-content" data-section="ai-chat" style="display:block;">

#### Chat with GPT-5 nano

```html;ai-chatgpt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.chat(`What is life?`, { model: "gpt-5-nano" }).then(puter.print);
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="text-to-image">

#### Generate an image of a cat using AI

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

</div>

<div class="example-content" data-section="image-to-text">

#### Extract the text contained in an image

```html;ai-img2txt
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.img2txt('https://assets.puter.site/letter.png').then(puter.print);
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="text-to-speech">

#### Convert text to speech

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

</div>

<div class="example-content" data-section="voice-changer">

#### Swap a sample clip into a new voice

```html;ai-voice-changer
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <button id="swap">Convert voice</button>
    <script>
        document.getElementById('swap').addEventListener('click', async ()=>{
            const audio = await puter.ai.speech2speech(
                'https://puter-sample-data.puter.site/tts_example.mp3',
                {
                    voice: '21m00Tcm4TlvDq8ikWAM',
                    model: 'eleven_multilingual_sts_v2',
                    output_format: 'mp3_44100_128'
                }
            );
            audio.play();
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="text-to-video">

#### Generate a sample Sora clip

```html;ai-txt2vid
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.txt2vid(
            "A drone shot sweeping over bioluminescent waves at night",
            true // test mode returns a sample video without spending credits
        ).then((video)=>{
            document.body.appendChild(video);
        });
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="speech-to-speech">

#### Convert speech in one voice to another voice

```html;ai-speech2speech-url
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.ai.speech2speech('https://assets.puter.site/example.mp3', {
            voice: '21m00Tcm4TlvDq8ikWAM',
            model: 'eleven_multilingual_sts_v2',
            output_format: 'mp3_44100_128'
        }).then(puter.print);
    </script>
</body>
</html>
```

</div>

<div class="example-content" data-section="speech-to-text">

#### Transcribe or translate audio recordings into text

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

</div>

## Functions

These AI features are supported out of the box when using Puter.js:

- **[`puter.ai.chat()`](/AI/chat/)** - Chat with AI models like Claude, GPT, and others
- **[`puter.ai.listModels()`](/AI/listModels/)** - List available AI chat models (and providers) that Puter currently exposes.
- **[`puter.ai.txt2img()`](/AI/txt2img/)** - Generate images from text descriptions
- **[`puter.ai.img2txt()`](/AI/img2txt/)** - Extract text from images (OCR)
- **[`puter.ai.txt2speech()`](/AI/txt2speech/)** - Convert text to speech
- **[`puter.ai.speech2speech()`](/AI/speech2speech/)** - Convert speech in one voice to another voice
- **[`puter.ai.txt2vid()`](/AI/txt2vid/)** - Generate short videos with OpenAI Sora models
- **[`puter.ai.speech2txt()`](/AI/speech2txt/)** - Transcribe or translate audio recordings into text

## Examples

You can see various Puter.js AI features in action from the following examples:

- AI Chat
  - [Chat with GPT-5 nano](/playground/ai-chatgpt/)
  - [Image Analysis](/playground/ai-gpt-vision/)
  - [Stream the response](/playground/ai-chat-stream/)
  - [Function Calling](/playground/ai-function-calling/)
  - [AI Resume Analyzer (File handling)](/playground/ai-resume-analyzer/)
  - [Chat with OpenAI o3-mini](/playground/ai-chat-openai-o3-mini/)
  - [Chat with Claude Sonnet](/playground/ai-chat-claude/)
  - [Chat with DeepSeek](/playground/ai-chat-deepseek/)
  - [Chat with Gemini](/playground/ai-chat-gemini/)
  - [Chat with xAI (Grok)](/playground/ai-xai/)
- Image to Text
  - [Extract Text from Image](/playground/ai-img2txt/)
- Text to Image
  - [Generate an image from text](/playground/ai-txt2img/)
  - [Text to Image with options](/playground/ai-txt2img-options/)
  - [Text to Image with image-to-image generation](/playground/ai-txt2img-image-to-image/)
- Text to Speech
  - [Generate speech audio from text](/playground/ai-txt2speech/)
  - [Text to Speech with options](/playground/ai-txt2speech-options/)
  - [Text to Speech with engines](/playground/ai-txt2speech-engines/)
  - [Text to Speech with OpenAI voices](/playground/ai-txt2speech-openai/)
  - [Transcribe audio with `speech2txt`](/AI/speech2txt/)
- Text to Video
  - [Generate a sample Sora clip](/AI/txt2vid/)
- Speech to Speech
  - [Convert speech in one voice to another voice](/playground/ai-speech2speech-url/)
  - [Convert speech in one voice to another voice with a recording stored as a file](/playground/ai-speech2speech-file/)
- Speech to Text
  - [Transcribe or translate audio recordings into text](/playground/ai-speech2txt/)

## Tutorials

- [Build an Enterprise Ready AI Powered Applicant Tracking System [video]](https://www.youtube.com/watch?v=iYOz165wGkQ)
- [Build a Modern AI Chat App with React, Tailwind & Puter.js [video]](https://www.youtube.com/watch?v=XNFgM5fkPkw)
- [Create an AI Text to Speech Website with React, Tailwind and Puter.js [video]](https://www.youtube.com/watch?v=ykQlkMPbpGw)
- [Build a Modern AI Chat with Multiple Models in React, Tailwind and Puter.js [video]](https://www.youtube.com/watch?v=7NVKb8bj548)
