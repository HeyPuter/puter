Given a prompt returns the completion that best matches the prompt.

## Syntax
```js
puter.ai.chat(prompt)
puter.ai.chat(prompt, options = {})
puter.ai.chat(prompt, testMode = false, options = {})
puter.ai.chat(prompt, imageURL, testMode = false, options = {})
puter.ai.chat(prompt, [imageURLArray], testMode = false, options = {})
puter.ai.chat([messages], testMode = false, options = {})
```

## Parameters
#### `prompt` (String)
A string containing the prompt you want to complete.

#### `options` (Object) (Optional)
An object containing the following properties:
- `model` (String) - The model you want to use for the completion. If not specified, defaults to `gpt-5-nano`. More than 500 models are available, including, but not limited to, OpenAI, Anthropic, Google, xAI, Mistral, OpenRouter, and DeepSeek. For a full list, see the [models list](https://puter.com/puterai/chat/models) page.
- `stream` (Boolean) - A boolean indicating whether you want to stream the completion. Defaults to `false`.
- `max_tokens` (Number) - The maximum number of tokens to generate in the completion. By default, the specific model's maximum is used.
- `temperature` (Number) - A number between 0 and 2 indicating the randomness of the completion. Lower values make the output more focused and deterministic, while higher values make it more random. By default, the specific model's temperature is used.
- `tools` (Array) (Optional) - An array of function definitions that the AI can call. Each function definition should have:
    - `type` (String) - Must be "function"
    - `function` (Object):
        - `name` (String) - The name of the function
        - `description` (String) - A description of what the function does
        - `parameters` (Object) - JSON Schema object describing the parameters
        - `strict` (Boolean) - Whether to enforce strict parameter validation

#### `testMode` (Boolean) (Optional)
A boolean indicating whether you want to use the test API. Defaults to `false`. This is useful for testing your code without using up API credits.

#### `imageURL` (String)
A string containing the URL of an image you want to provide as context for the completion. Also known as "GPT Vision".

#### `imageURLArray` (Array)
An array of strings containing the URLs of images you want to provide as context for the completion. 

#### `messages` (Array)
An array of objects containing the messages you want to complete. Each object must have a `role` and a `content` property. The `role` property must be one of `system`, `assistant`, `user`, or `function`. The `content` property can be:

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
        role: 'system',
        content: 'Hello, how are you?'
    },
    {
        role: 'user',
        content: 'I am doing well, how are you?'
    },
]
```

An example with mixed content including files:

```js
[
    {
        role: 'user',
        content: [
            {
                type: 'file',
                puter_path: '~/Desktop/document.pdf'
            },
            {
                type: 'text',
                text: 'Please summarize this document'
            }
        ]
    }
]
```

Providing a messages array is especially useful for building chatbots where you want to provide context to the completion.

## Return value

When `stream` is set to `false` (default):
- Will resolve to a response object containing the completion message, with the following format:
  - `message` (Object):
    - `role` (String) - Indicates who is speaking in the conversation
    - `content` (String) - The actual text response from the chat
- If a function call is made, the response will include `tool_calls` array containing:
  - `id` (String) - Unique identifier for the function call
  - `function` (Object):
    - `name` (String) - Name of function to call
    - `arguments` (String) - JSON string of function arguments

When `stream` is set to `true`:
- Returns an async iterable object that you can use with a `for await...of` loop to receive the response in parts as they become available.

In case of an error, the `Promise` will reject with an error message.

## Vendors

We use different vendors for different models and try to use the best vendor available at the time of the request. Vendors include, but are not limited to, OpenAI, Anthropic, Google, xAI, Mistral, OpenRouter, and DeepSeek.


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
        const resp = await puter.ai.chat('Tell me in detail what Rick and Morty is all about.', {model: 'claude', stream: true });
        for await ( const part of resp ) document.write(part?.text.replaceAll('\n', '<br>'));
    })();
    </script>
</body>
</html>
```

<strong class="example-title">Function Calling</strong>

```html;ai-function-calling
<!DOCTYPE html>
<html>
<head>
    <title>Weather Function Calling Demo</title>
    <script src="https://js.puter.com/v2/"></script>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; }
        .container { border: 1px solid #ccc; padding: 20px; border-radius: 5px; }
        input { width: 100%; padding: 10px; margin: 10px 0; box-sizing: border-box; }
        button { width: 100%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;}
        button:disabled { background: #ccc; }
        #response { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; display: none;}
    </style>
</head>
<body>
    <div class="container">
        <h1>Weather Function Calling Demo</h1>
        <input type="text" id="userInput" value="What's the weather in Paris?" placeholder="Ask about the weather" />
        <button id="submit">Submit</button>
        <div id="response"></div>
    </div>

    <script>
        // Mock weather function
        function getWeather(location) {
            const mockWeatherData = {
                'Paris': '22°C, Partly Cloudy',
                'London': '18°C, Rainy',
                'New York': '25°C, Sunny',
                'Tokyo': '28°C, Clear'
            };
            return mockWeatherData[location] || '20°C, Unknown';
        }

        // Define the tools available to the AI
        const tools = [{
            type: "function",
            function: {
                name: "get_weather",
                description: "Get current weather for a given location",
                parameters: {
                    type: "object",
                    properties: {
                        location: {
                            type: "string",
                            description: "City name e.g. Paris, London"
                        }
                    },
                    required: ["location"]
                }
            }
        }];

        async function handleSubmit() {
            const userInput = document.getElementById('userInput').value;
            const submitBtn = document.getElementById('submit');
            const responseDiv = document.getElementById('response');
            
            if (!userInput) return;

            submitBtn.disabled = true;
            submitBtn.textContent = 'Loading...';
            responseDiv.style.display = 'none';

            try {
                const completion = await puter.ai.chat(userInput, { tools });
                let finalResponse;

                // Check if AI wants to call a function
                if (completion.message.tool_calls?.length > 0) {
                    const toolCall = completion.message.tool_calls[0];
                    if (toolCall.function.name === 'get_weather') {
                        const args = JSON.parse(toolCall.function.arguments);
                        const weatherData = getWeather(args.location);
                        
                        // Send weather data back to AI for final response
                        finalResponse = await puter.ai.chat([
                            { role: "user", content: userInput },
                            completion.message,
                            { 
                                role: "tool",
                                tool_call_id: toolCall.id,
                                content: weatherData
                            }
                        ]);
                    }
                } else {
                    finalResponse = completion;
                }

                responseDiv.innerHTML = `<strong>Response:</strong><br>${finalResponse}`;
                responseDiv.style.display = 'block';
            } catch (error) {
                responseDiv.innerHTML = `<strong>Error:</strong><br>${error.message}`;
                responseDiv.style.display = 'block';
            }

            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit';
        }

        // Event handlers
        document.getElementById('submit').addEventListener('click', handleSubmit);
        document.getElementById('userInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') handleSubmit();
        });
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
