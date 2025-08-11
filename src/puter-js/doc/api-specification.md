# Puter.js API Specification

This document describes the API interfaces for Puter.js, including the AI chat functionality and other core features.

## Table of Contents

1. [Chat](#chat)

---

## Chat

### Overview

The `puter.ai.chat()` method provides a flexible interface for interacting with various AI language models through Puter's driver system. It supports multiple input formats, automatic parameter detection, vision capabilities, and intelligent driver selection.

### Core Method: `puter.ai.chat(...args)`

**Description**: Send messages to AI models and receive intelligent responses with automatic format detection and parameter processing.

**Returns**: Promise that resolves to a response object with automatic content access methods.

### Function Signatures

The `chat` method supports multiple function signatures through intelligent parameter detection:

#### 1. Basic Text Chat
```javascript
// Simple string prompt
await puter.ai.chat("Hello, how are you?")

// String with test mode
await puter.ai.chat("Hello", true)
```

#### 2. Vision with Single Image
```javascript
// File object
await puter.ai.chat("Describe this image", imageFile)

// Image URL
await puter.ai.chat("Analyze this image", "https://example.com/image.jpg")

// With test mode
await puter.ai.chat("Describe this image", imageFile, true)
```

#### 3. Vision with Multiple Images
```javascript
// Array of files
await puter.ai.chat("Compare these images", [image1, image2, image3])

// Array of URLs
await puter.ai.chat("Analyze these images", ["url1", "url2"])
```

#### 4. Conversation Array
```javascript
// Standard message format
await puter.ai.chat([
  { role: "user", content: "What is AI?" },
  { role: "assistant", content: "AI stands for Artificial Intelligence..." }
])

// Simple string array (auto-converted)
await puter.ai.chat(["hi", "how are you?"])
```

#### 5. Full Parameter Object
```javascript
await puter.ai.chat({
  messages: [{ role: "user", content: "Hello" }],
  model: "gpt-4o",
  temperature: 0.7,
  max_tokens: 1000
})
```

#### 6. Mixed Parameters
```javascript
// Text with parameters
await puter.ai.chat("Hello", {
  model: "claude-3-opus",
  temperature: 0.8
})

// Vision with parameters
await puter.ai.chat("Describe this", imageFile, {
  model: "gpt-4o",
  stream: true
})
```

### Parameter Processing

#### Automatic Detection Logic

The method automatically detects input formats in this order:

1. **String Detection**: If `args[0]` is a string, it's treated as a prompt
2. **Vision Detection**: If `args[1]` is a File, string (URL), or array, vision mode is enabled
3. **Test Mode Detection**: Boolean parameters anywhere in the argument list enable test mode
4. **Object Detection**: Non-array objects are treated as user parameters

#### Parameter Merging

```javascript
// User parameters are merged with detected parameters
const response = await puter.ai.chat("Hello", imageFile, {
  model: "claude-3-opus",
  temperature: 0.8
})

// Results in:
// - vision: true (auto-detected from imageFile)
// - messages: [{ content: ["Hello", { image_url: { url: "..." } }] }]
// - model: "claude-3-opus" (from user params)
// - temperature: 0.8 (from user params)
```

#### Vision Processing

When images are detected, the method automatically:

```javascript
// Converts File objects to data URIs
if(args[1] instanceof File){
    args[1] = await utils.blobToDataUri(args[1]);
}

// Sets vision flag
requestParams.vision = true;

// Structures content as arrays
messages: [{
    content: [
        "prompt text",
        { image_url: { url: "data:image/..." } }
    ]
}]
```

### Model Mapping

#### Automatic Model Name Conversion

The system automatically maps and transforms model names:

```javascript
// Claude model aliases
'claude-3-5-sonnet' → 'claude-3-5-sonnet-latest'
'claude-3-7-sonnet' → 'claude-3-7-sonnet-latest'
'claude' → 'claude-3-7-sonnet-latest'
'claude-sonnet-4' → 'claude-sonnet-4-20250514'
'claude-opus-4' → 'claude-opus-4-20250514'

// Special mappings
'mistral' → 'mistral-large-latest'
'groq' → 'llama3-8b-8192'
'deepseek' → 'deepseek-chat'
'o1-mini' → 'openrouter:openai/o1-mini'

// Prefix handling
'anthropic/claude-3-opus' → 'claude-3-opus' (prefix removed)
'openai/gpt-4o' → 'gpt-4o' (prefix removed)
```

#### Vendor Prefix Handling

```javascript
// Automatic openrouter prefixing
'meta-llama/Llama-3.1-8B' → 'openrouter:meta-llama/Llama-3.1-8B'
'google/gemma-2-27b-it' → 'openrouter:google/gemma-2-27b-it'
'deepseek/deepseek-chat' → 'openrouter:deepseek/deepseek-chat'
'x-ai/grok-beta' → 'openrouter:x-ai/grok-beta'
```

### Driver Selection

#### Automatic Driver Mapping

The system automatically selects the appropriate driver based on the model:

```javascript
// OpenAI models
if (!requestParams.model || requestParams.model.startsWith('gpt-')) {
    driver = 'openai-completion';
}

// Claude models
else if (requestParams.model.startsWith('claude-')) {
    driver = 'claude';
}

// Together AI models
else if (requestParams.model === 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' ||
         requestParams.model === 'google/gemma-2-27b-it') {
    driver = 'together-ai';
}

// Mistral models
else if (requestParams.model.startsWith('mistral-') || 
         requestParams.model.startsWith('codestral-') ||
         requestParams.model.startsWith('pixtral-')) {
    driver = 'mistral';
}

// Groq models
else if (['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768'].includes(requestParams.model)) {
    driver = 'groq';
}

// Special models
else if (requestParams.model === 'grok-beta') {
    driver = 'xai';
}
else if (requestParams.model === 'deepseek-chat') {
    driver = 'deepseek';
}
else if (requestParams.model.startsWith('gemini-')) {
    driver = 'gemini';
}
else if (requestParams.model.startsWith('openrouter:')) {
    driver = 'openrouter';
}
```

#### Driver Override

Users can override automatic driver selection:

```javascript
await puter.ai.chat("Hello", {
    model: "gpt-4o",
    driver: "claude"  // Forces Claude driver even with GPT model
});
```

### Response Handling

#### Response Transformation

The method automatically transforms responses for convenience:

```javascript
const response = await puter.ai.chat("Hello");

// Automatic content access
response.toString()        // Returns response.message.content
response.valueOf()         // Returns response.message.content

// Standard access
response.message.content   // The actual response text
response.message.role      // Usually "assistant"
response.usage             // Token usage information
```

#### Response Structure

```javascript
{
    message: {
        role: "assistant",
        content: "Hello! How can I help you today?"
    },
    usage: {
        prompt_tokens: 10,
        completion_tokens: 25,
        total_tokens: 35
    }
}
```

### Examples

#### Basic Usage

```javascript
// Simple chat
const response = await puter.ai.chat("What is the capital of France?");
console.log(response.toString()); // "The capital of France is Paris."

// With model specification
const response = await puter.ai.chat("Explain quantum computing", {
    model: "claude-3-opus",
    temperature: 0.7
});
```

#### Vision Examples

```javascript
// Single image analysis
const response = await puter.ai.chat("What do you see in this image?", imageFile);

// Multiple image comparison
const response = await puter.ai.chat("Compare these two images", [image1, image2]);

// Image with specific model
const response = await puter.ai.chat("Analyze this image", imageFile, {
    model: "gpt-4o",
    max_tokens: 500
});
```

#### Advanced Features

```javascript
// Function calling
const response = await puter.ai.chat("Get the weather for London", {
    tools: [{
        type: "function",
        function: {
            name: "get_weather",
            description: "Get weather for a location",
            parameters: {
                type: "object",
                properties: {
                    location: { type: "string" }
                },
                required: ["location"]
            }
        }
    }]
});

// Streaming response
const response = await puter.ai.chat("Write a story", {
    stream: true
});

// Test mode (bypasses actual API calls)
const response = await puter.ai.chat("Hello", true);
```

#### Conversation Management

```javascript
// Multi-turn conversation
const conversation = [
    { role: "user", content: "My name is Alice" },
    { role: "assistant", content: "Nice to meet you, Alice!" },
    { role: "user", content: "What should I call you?" }
];

const response = await puter.ai.chat(conversation);

// Simple string conversation
const response = await puter.ai.chat(["Hi", "How are you?", "Tell me a joke"]);
```

### Implementation Details

#### Core Processing Flow

1. **Argument Analysis**: Parse and detect input formats
2. **Parameter Detection**: Identify vision, test mode, and user parameters
3. **Model Processing**: Transform model names and detect drivers
4. **Request Building**: Construct the final request parameters
5. **Driver Execution**: Call the appropriate backend driver
6. **Response Transformation**: Add convenience methods to the response

#### Error Handling

```javascript
// Argument validation
if(!args){ 
    throw({message: 'Arguments are required', code: 'arguments_required'});
}

// File processing errors are handled gracefully
// Model mapping errors fall back to default drivers
// Driver errors are propagated from the backend
```

#### Performance Considerations

- **Lazy Evaluation**: Parameters are processed only when needed
- **Efficient Detection**: Single-pass argument analysis
- **Minimal Transformations**: Only necessary conversions are performed
- **Driver Caching**: Driver selection is optimized for common models

### Best Practices

#### Recommended Usage Patterns

1. **Use simple strings for basic queries**: `chat("Hello")`
2. **Specify models explicitly** for consistent behavior
3. **Use vision mode** for image analysis tasks
4. **Enable test mode** during development
5. **Override drivers** only when necessary

#### Common Pitfalls

1. **Mixing parameter orders** can lead to unexpected behavior
2. **File size limits** apply to vision inputs
3. **Model availability** varies by driver and region
4. **Rate limiting** is enforced per driver and user

#### Debugging Tips

1. **Enable test mode** to bypass external API calls
2. **Check driver selection** with explicit driver specification
3. **Verify model names** match supported formats
4. **Monitor response structure** for proper content access
