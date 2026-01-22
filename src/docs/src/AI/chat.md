---
title: puter.ai.chat()
description: Chat with AI models, analyze images, and perform function calls using 500+ models from OpenAI, Anthropic, Google, and more.
platforms: [websites, apps, nodejs, workers]
---

Given a prompt returns the completion that best matches the prompt.

## Syntax

```js
puter.ai.chat(prompt)
puter.ai.chat(prompt, options = {})
puter.ai.chat(prompt, testMode = false, options = {})
puter.ai.chat(prompt, image, testMode = false, options = {})
puter.ai.chat(prompt, [imageURLArray], testMode = false, options = {})
puter.ai.chat([messages], testMode = false, options = {})
```

## Parameters

#### `prompt` (String)

A string containing the prompt you want to complete.

#### `options` (Object) (Optional)

An object containing the following properties:

- `model` (String) - The model you want to use for the completion. If not specified, defaults to `gpt-5-nano`. More than 500 models are available, including, but not limited to, OpenAI, Anthropic, Google, xAI, Mistral, OpenRouter, and DeepSeek. For a full list, see the [AI models list](https://developer.puter.com/ai/models/) page.
- `stream` (Boolean) - A boolean indicating whether you want to stream the completion. Defaults to `false`.
- `max_tokens` (Number) - The maximum number of tokens to generate in the completion. By default, the specific model's maximum is used.
- `temperature` (Number) - A number between 0 and 2 indicating the randomness of the completion. Lower values make the output more focused and deterministic, while higher values make it more random. By default, the specific model's temperature is used.
- `tools` (Array) (Optional) - Function definitions the AI can call. See [Function Calling](#function-calling) for details.
- `reasoning_effort` / `reasoning.effort` (String) (Optional) - Controls how much effort reasoning models spend thinking. Supported values: `none`, `minimal`, `low`, `medium`, `high`, and `xhigh`. Lower values give faster responses with less reasoning. OpenAI models only.
- `text` / `text_verbosity` (String) (Optional) - Controls how long or short responses are. Supported values: `low`, `medium`, and `high`. Lower values give shorter responses. OpenAI models only.

#### `testMode` (Boolean) (Optional)

A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

#### `image` (String | File)

A string containing the URL or Puter path of the image, or a `File` object containing the image you want to provide as context for the completion.

#### `imageURLArray` (Array)

An array of strings containing the URLs of images you want to provide as context for the completion.

#### `messages` (Array)

An array of objects containing the messages you want to complete. Each object must have a `role` and a `content` property. The `role` property must be one of `system`, `assistant`, `user`, or `tool`. The `content` property can be:

1. A string containing the message text
2. An array of content objects for multimodal messages

When using an array of content objects, each object can have:

- `type` (String) - The type of content:
  - `"text"` - Text content
  - `"file"` - File content
- `text` (String) - The text content (required when type is "text")
- `puter_path` (String) - The path to the file in Puter's file system (required when type is "file")

An example of a valid `messages` parameter with text only:

```js
[
  {
    role: "system",
    content: "Hello, how are you?",
  },
  {
    role: "user",
    content: "I am doing well, how are you?",
  },
];
```

An example with mixed content including files:

```js
[
  {
    role: "user",
    content: [
      {
        type: "file",
        puter_path: "~/Desktop/document.pdf",
      },
      {
        type: "text",
        text: "Please summarize this document",
      },
    ],
  },
];
```

Providing a messages array is especially useful for building chatbots where you want to provide context to the completion.

## Return value

Returns a `Promise` that resolves to either:

- A [`ChatResponse`](/Objects/chatresponse) object containing the chat response data, or
- An async iterable object of [`ChatResponseChunk`](/Objects/chatresponsechunk) (when `stream` is set to `true`) that you can use with a `for await...of` loop to receive the response in parts as they become available.

In case of an error, the `Promise` will reject with an error message.

## Vendors

We use different vendors for different models and try to use the best vendor available at the time of the request. Vendors include, but are not limited to, OpenAI, Anthropic, Google, xAI, Mistral, OpenRouter, and DeepSeek.

## Function Calling

Function calling (also known as tool calling) allows AI models to request data or perform actions by calling functions you define. This enables the AI to access real-time information, interact with external systems, and perform tasks beyond its training data.

1. **Define tools** - Create function specifications in the `tools` array passed to `puter.ai.chat()`
2. **AI requests a tool call** - If the AI determines it needs to call a function, it responds with a `tool_calls` array instead of a text message
3. **Execute the function** - Your code matches the requested function and runs it with the provided arguments
4. **Send the result back** - Pass the function result back to the AI with `role: "tool"`
5. **AI responds** - The AI uses the tool result to generate its final response

Tools are defined in the `tools` parameter as an array of function specifications:

- `type` (String) - Must be `"function"`
- `function.name` (String) - The function name (e.g., `"get_weather"`)
- `function.description` (String) - Description of what the function does and when to use it
- `function.parameters` (Object) - [JSON Schema](https://json-schema.org/) object defining the function's input arguments
- `function.strict` (Boolean) (Optional) - Whether to enforce strict parameter validation

When the AI wants to call a function, the response includes `message.tool_calls`. Each tool call contains:

- `id` (String) - Unique identifier for this tool call (used when sending results back)
- `function.name` (String) - The name of the function to call
- `function.arguments` (String) - JSON string containing the function arguments

After executing the function, send the result back by including a message with:

- `role` (String) - Must be `"tool"`
- `tool_call_id` (String) - The `id` from the tool call
- `content` (String) - The function result as a string

See the [Function Calling example](/playground/ai-function-calling/) for a complete working implementation.

### Web Search

Specific to OpenAI models, you can use the built-in web search tool, allowing the AI to access up-to-date information from the internet.

Pass in the `tools` parameter with the type of `web_search`.

```js
{
  model: 'openai/gpt-5.2-chat',
  tools: [{type: "web_search"}]
}
```

The code implementation is available in our [web search example](/playground/ai-web-search/).

List of OpenAI models that support the web search can be found in their [API compatibility documentation](https://platform.openai.com/docs/guides/tools-web-search#api-compatibility).

## Examples

<strong class="example-title">Ask GPT-5 nano a question</strong>

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

<strong class="example-title">Image Analysis</strong>

```html;ai-gpt-vision
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <img src="https://assets.puter.site/doge.jpeg" style="display:block;">
    <script>
        puter.ai
            .chat(`What do you see?`, `https://assets.puter.site/doge.jpeg`, {
                model: "gpt-5-nano",
            })
            .then(puter.print);
    </script>
</body>
</html>
```

<strong class="example-title">Stream the response</strong>

```html;ai-chat-stream
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
    (async () => {
        const resp = await puter.ai.chat('Tell me in detail what Rick and Morty is all about.', {model: 'gemini-2.5-flash-lite', stream: true });
        for await ( const part of resp ) document.write(part?.text.replaceAll('\n', '<br>'));
    })();
    </script>
</body>
</html>
```

<strong class="example-title">Function Calling</strong>

```html;ai-function-calling
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        // Mock weather function
        function getWeather(location) {
            return location + ': 22°C, Sunny';
        }

        // Define the tool
        const tools = [{
            type: "function",
            function: {
                name: "get_weather",
                description: "Get current weather for a location",
                parameters: {
                    type: "object",
                    properties: {
                        location: { type: "string", description: "City name" }
                    },
                    required: ["location"]
                }
            }
        }];

        (async () => {
            const question = "What's the weather in Paris?";
            puter.print("Question: " + question + "<br/>");
            puter.print("(Loading...)<br/>");

            // Call AI with tools
            const response = await puter.ai.chat(question, { tools });

            // Check if AI wants to call a function
            if (response.message.tool_calls?.length > 0) {
                const toolCall = response.message.tool_calls[0];
                const args = JSON.parse(toolCall.function.arguments);
                const weatherData = getWeather(args.location);

                // Send result back to AI
                const finalResponse = await puter.ai.chat([
                    { role: "user", content: question },
                    response.message,
                    { role: "tool", tool_call_id: toolCall.id, content: weatherData }
                ]);

                puter.print("Answer: " + finalResponse);
            } else {
                // If the AI responds directly without calling a tool, print its message
                puter.print("Answer: " + response);
            }
        })();
    </script>
</body>
</html>
```

<strong class="example-title">Web Search</strong>

```html;ai-web-search
<html>
<body>
    <script src="https://js.puter.com/v2/"></script>
    <script>
        puter.print(`Loading...`);
        puter.ai
            .chat("Summarize what the User-Pays Model is: https://docs.puter.com/user-pays-model/", {
                model: "openai/gpt-5.2-chat",
                tools: [{ type: "web_search" }],
            })
            .then(puter.print);
    </script>
</body>
</html>
```

<strong class="example-title">Working with Files</strong>

```html;ai-resume-analyzer
<!DOCTYPE html>
<html>
<head>
    <title>Resume Analyzer</title>
    <script src="https://js.puter.com/v2/"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px;}
        .container { border: 1px solid #ccc; padding: 20px; border-radius: 5px;}
        .upload-area {border: 2px dashed #ccc; padding: 40px; text-align: center; margin: 20px 0; border-radius: 5px; cursor: pointer;  transition: border-color 0.3s;}
        .upload-area:hover {border-color: #007bff;}
        .upload-area.dragover { border-color: #007bff; background-color: #f8f9fa;}
        input[type="file"] { display: none;}
        button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin-top: 10px;}
        button:disabled { background: #ccc; }
        #response { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; display: none; }
        .file-name { margin-top: 10px; font-style: italic; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Resume Analyzer</h1>
        <p>Upload your resume (PDF, DOC, or TXT) and get a quick analysis of your key strengths in two sentences.</p>

        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
            <p>Click here to upload your resume or drag and drop</p>
            <input type="file" id="fileInput" accept=".pdf,.doc,.docx,.txt" />
        </div>

        <div class="file-name" id="fileName" style="display: none;"></div>

        <button id="analyzeBtn" disabled>Analyze My Resume</button>

        <div id="response"></div>
    </div>

    <script>
        let uploadedFile = null;

        // File upload handling
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.querySelector('.upload-area');
        const fileName = document.getElementById('fileName');
        const analyzeBtn = document.getElementById('analyzeBtn');
        const response = document.getElementById('response');

        fileInput.addEventListener('change', handleFileSelect);
        uploadArea.addEventListener('dragover', handleDragOver);
        uploadArea.addEventListener('drop', handleDrop);

        function handleFileSelect(e) {
            const file = e.target.files[0];
            if (file) {
                uploadedFile = file;
                fileName.textContent = `Selected: ${file.name}`;
                fileName.style.display = 'block';
                analyzeBtn.disabled = false;
            }
        }

        function handleDragOver(e) {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        }

        function handleDrop(e) {
            e.preventDefault();
            uploadArea.classList.remove('dragover');

            const file = e.dataTransfer.files[0];
            if (file) {
                uploadedFile = file;
                fileName.textContent = `Selected: ${file.name}`;
                fileName.style.display = 'block';
                analyzeBtn.disabled = false;
            }
        }

        // Remove dragover class when drag leaves
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        // Analyze resume
        analyzeBtn.addEventListener('click', async () => {
            if (!uploadedFile) return;

            analyzeBtn.disabled = true;
            analyzeBtn.textContent = 'Analyzing...';
            response.style.display = 'none';

            try {
                // First, upload the file to Puter
                const puterFile = await puter.fs.write(`temp_resume_${Date.now()}.${uploadedFile.name.split('.').pop()}`,
                    uploadedFile
                );

                const uploadedPath = puterFile.path;

                // Analyze the resume with AI
                const completion = await puter.ai.chat([
                    {
                        role: 'user',
                        content: [
                            {
                                type: 'file',
                                puter_path: uploadedPath
                            },
                            {
                                type: 'text',
                                text: 'Please analyze this resume and suggest how to improve it. Only a few sentences are needed.'
                            }
                        ]
                    }
                ], { model: 'claude-sonnet-4', stream: true });

                let text = '';

                // Display the response
                for await ( const part of completion ) {
                    text += part?.text;
                    response.innerHTML = text;
                }

                response.style.display = 'block';

                // Clean up the temporary file
                await puter.fs.delete(uploadedPath);

            } catch (error) {
                response.innerHTML = `<strong>Error:</strong><br>${error.message}`;
                response.style.display = 'block';
            }

            analyzeBtn.disabled = false;
            analyzeBtn.textContent = 'Analyze My Resume';
        });
    </script>
</body>
</html>
```
