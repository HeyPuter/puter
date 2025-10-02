The Puter.js AI feature allows you to integrate artificial intelligence capabilities into your applications.

You can use AI models from various providers to perform tasks such as chat, text-to-image, image-to-text, and text-to-speech conversion. And with the [User Pays Model](/user-pays-model/), you don't have to set up your own API keys and top up credits, because users cover their own AI costs.

<h2 style="margin-top: 60px;">Examples</h2>
<div style="overflow:hidden; margin-bottom: 30px;">
    <div class="example-group active" data-section="ai-chat"><span>AI Chat</span></div>
    <div class="example-group" data-section="text-to-image"><span>Text to Image</span></div>
    <div class="example-group" data-section="image-to-text"><span>Image to Text</span></div>
    <div class="example-group" data-section="text-to-speech"><span>Text to Speech</span></div>
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
        puter.ai.img2txt('https://cdn.handwrytten.com/www/2020/02/home-hero-photo2%402x.png').then(puter.print);
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

## Functions

These AI features are supported out of the box when using Puter.js:

- **[`puter.ai.chat()`](/AI/chat/)** - Chat with AI models like Claude, GPT, and others
- **[`puter.ai.txt2img()`](/AI/txt2img/)** - Generate images from text descriptions
- **[`puter.ai.img2txt()`](/AI/img2txt/)** - Extract text from images (OCR)
- **[`puter.ai.txt2speech()`](/AI/txt2speech/)** - Convert text to speech

## Examples

You can see various Puter.js AI features in action from the following examples:

- AI Chat
  - [Chat with GPT-5 nano](/playground/?example=ai-chatgpt)
  - [Image Analysis](/playground/?example=ai-gpt-vision)
  - [Stream the response](/playground/?example=ai-chat-stream)
  - [Function Calling](/playground/?example=ai-function-calling)
  - [AI Resume Analyzer (File handling)](/playground/?example=ai-resume-analyzer)
  - [Chat with OpenAI o3-mini](/playground/?example=ai-chat-openai-o3-mini)
  - [Chat with Claude Sonnet](/playground/?example=ai-chat-claude)
  - [Chat with DeepSeek](/playground/?example=ai-chat-deepseek)
  - [Chat with Gemini](/playground/?example=ai-chat-gemini)
  - [Chat with xAI (Grok)](/playground/?example=ai-xai)
- Image to Text
  - [Extract Text from Image](/playground/?example=ai-img2txt)
- Text to Image
  - [Generate an image from text](/playground/?example=ai-txt2img)
  - [Text to Image with options](/playground/?example=ai-txt2img-options)
  - [Text to Image with image-to-image generation](/playground/?example=ai-txt2img-image-to-image)
- Text to Speech
  - [Generate speech audio from text](/playground/?example=ai-txt2speech)
  - [Text to Speech with options](/playground/?example=ai-txt2speech-options)
  - [Text to Speech with engines](/playground/?example=ai-txt2speech-engines)

## Tutorials

- [Build an Enterprise Ready AI Powered Applicant Tracking System [video]](https://www.youtube.com/watch?v=iYOz165wGkQ)
- [Build a Modern AI Chat App with React, Tailwind & Puter.js [video]](https://www.youtube.com/watch?v=XNFgM5fkPkw)
- [Create an AI Text to Speech Website with React, Tailwind and Puter.js [video]](https://www.youtube.com/watch?v=ykQlkMPbpGw)
- [Build a Modern AI Chat with Multiple Models in React, Tailwind and Puter.js [video]](https://www.youtube.com/watch?v=7NVKb8bj548)
