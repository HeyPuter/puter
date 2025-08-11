# Puter AI API Specification

This document describes the API interfaces for Puter's AI services, including chat completions, image generation, and text-to-speech capabilities.

## Table of Contents

1. [Chat Completions](#chat-completions)
2. [Image Generation](#image-generation)
3. [Text-to-Speech](#text-to-speech)
4. [Model Management](#model-management)
5. [Common Patterns](#common-patterns)

---

## Chat Completions

### Overview

Chat completions allow you to send messages to AI language models and receive intelligent responses. This interface supports multiple providers including OpenAI, Claude, Gemini, and others.

The `puter-chat-completion` interface provides a standardized way to interact with various Large Language Model (LLM) providers through Puter's driver system. This interface abstracts away provider-specific implementations and provides a consistent API for chat completions, model listing, and model information retrieval.

### Interface: `puter-chat-completion`

#### Method: `complete`

**Summary**: Send a conversation to an AI model and receive a completion response.

**Description**: Get completions for a chat log with support for multiple input formats including text prompts, conversation arrays, and vision capabilities.

**Parameters**:
- `messages` (type: `json`, required): Array of chat messages or content array for vision
  - Format: Array of message objects with `role` and `content` properties
  - For vision: Content array with text and image objects
  - Example: `[{ role: "user", content: "Hello!" }, { role: "assistant", content: "Hi there!" }]`
  - Vision Example: `[{ content: ["Describe this image", { image_url: { url: "data:image/..." } }] }]`
- `model` (type: `string`, optional): Specific model to use for completion
- `temperature` (type: `number`, optional): Controls randomness (0.0 to 2.0)
- `max_tokens` (type: `number`, optional): Maximum number of tokens to generate
- `stream` (type: `boolean`, optional): Whether to stream the response
- `tools` (type: `json`, optional): Function calling tools to make available
- `vision` (type: `boolean`, optional): Whether to enable vision capabilities (auto-detected)
- `response` (type: `json`, optional): Response format specification
- `driver` (type: `string`, optional): Override automatic driver selection

**Result**: JSON response with completion data

#### puter.js Usage

The `puter.ai.chat()` method supports multiple function signatures for different use cases:

**Basic Text Chat**:
```javascript
// Simple text prompt
const response = await puter.ai.chat("Hello, how are you?");

// With specific model and parameters
const response = await puter.ai.chat("Explain quantum computing", {
  model: "gpt-4o",
  temperature: 0.8,
  max_tokens: 1000
});
```

**Conversation History**:
```javascript
// With conversation array
const response = await puter.ai.chat([
  { role: "user", content: "What is AI?" },
  { role: "assistant", content: "AI stands for Artificial Intelligence..." },
  { role: "user", content: "Can you give me examples?" }
]);

// Simple message array (auto-converted to proper format)
const response = await puter.ai.chat(["hi"]);
const response = await puter.ai.chat(["Hello", "How are you?"]);
```

**Vision Capabilities**:
```javascript
// Single image with prompt
const response = await puter.ai.chat("Describe this image", imageFile);

// Single image with prompt and test mode
const response = await puter.ai.chat("Describe this image", imageFile, true);

// Multiple images with prompt
const response = await puter.ai.chat("Compare these images", [image1, image2, image3]);

// Image URLs
const response = await puter.ai.chat("Analyze this image", "https://example.com/image.jpg");
```

**Advanced Parameters**:
```javascript
// Function calling with tools
const response = await puter.ai.chat("What's the weather like?", {
  tools: [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a location",
        parameters: {
          type: "object",
          properties: {
            location: { type: "string" }
          },
          required: ["location"]
        }
      }
    }
  ]
});

// Streaming response
const response = await puter.ai.chat("Write a story", {
  stream: true
});

// Override driver selection
const response = await puter.ai.chat("Hello", {
  driver: "claude"
});
```

**Test Mode**:
```javascript
// Enable test mode (bypasses actual API calls)
const response = await puter.ai.chat("Hello", true);
const response = await puter.ai.chat("Hello", imageFile, true);
const response = await puter.ai.chat("Hello", { testMode: true });
```

#### Function Signature Overloads

The `chat` method automatically detects the input format and processes accordingly:

1. **`chat(prompt: string)`** → Basic text completion
2. **`chat(prompt: string, testMode: boolean)`** → Text with test mode
3. **`chat(prompt: string, image: File|string)`** → Vision with single image
4. **`chat(prompt: string, image: File|string, testMode: boolean)`** → Vision with test mode
5. **`chat(prompt: string, images: File[]|string[])`** → Vision with multiple images
6. **`chat(messages: Message[])`** → Conversation array with proper format
7. **`chat(messages: string[])`** → Simple string array (auto-converted to proper format)
8. **`chat(params: object)`** → Full parameter object
9. **`chat(prompt: string, params: object)`** → Text with parameters

#### Vision Processing

When images are provided, the method automatically:
- Converts File objects to data URIs
- Sets `vision: true` flag
- Structures content as arrays with text and image objects
- Supports both single and multiple images

**Image Format**:
```javascript
{
  vision: true,
  messages: [{
    content: [
      "Describe this image",
      {
        image_url: {
          url: "data:image/jpeg;base64,..."
        }
      }
    ]
  }]
}
```

#### Model Mapping and Driver Selection

The system automatically maps models to appropriate drivers:

**OpenAI Models** (driver: `openai-completion`):
- `gpt-*` models (gpt-4o, gpt-3.5-turbo, etc.)
- `openai/*` prefix is automatically removed

**Claude Models** (driver: `claude`):
- `claude-*` models
- `anthropic/*` prefix is automatically removed
- Model aliases: `claude` → `claude-3-7-sonnet-latest`

**Gemini Models** (driver: `gemini`):
- `gemini-1.5-flash`, `gemini-2.0-flash`

**Groq Models** (driver: `groq`):
- `mistral` → `mistral-large-latest`
- `groq` → `llama3-8b-8192`
- Various Llama models

**OpenRouter Models** (driver: `openrouter`):
- `openrouter:*` prefix
- Meta Llama, Google, DeepSeek, x-AI models automatically prefixed

**Special Models**:
- `o1-mini` → `openrouter:openai/o1-mini`
- `deepseek` → `deepseek-chat`

#### Backend HTTP API

**Endpoint**: `POST /drivers/call`

**Request**:
```json
{
  "interface": "puter-chat-completion",
  "driver": "openai-completion",
  "method": "complete",
  "args": {
    "messages": [
      {
        "role": "user",
        "content": "Hello, how are you?"
      }
    ],
    "model": "gpt-4o",
    "temperature": 0.7,
    "max_tokens": 1000,
    "stream": false,
    "vision": false
  }
}
```

**Response**:

*Success Response*:
```json
{
  "success": true,
  "result": {
    "message": {
      "role": "assistant",
      "content": "Hello! I'm doing well, thank you for asking. How can I help you today?"
    },
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 25,
      "total_tokens": 35
    }
  }
}
```

*Error Response*:
```json
{
  "success": false,
  "error": {
    "code": "rate_limit_exceeded",
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

**HTTP Status**: All responses return HTTP 200, even for errors. Check the `success` field in the response body to determine if the operation succeeded.

#### Response Transformation

The `puter.ai.chat()` method automatically transforms responses to provide convenient access to content:

```javascript
const response = await puter.ai.chat("Hello");

// Direct content access
console.log(response.toString());        // Returns response.message.content
console.log(response.valueOf());         // Returns response.message.content

// Standard response structure
console.log(response.message.content);   // The actual response text
console.log(response.message.role);      // Usually "assistant"
console.log(response.usage);             // Token usage information
```

#### Test Mode

Test mode allows you to bypass actual API calls for development and testing:

**Enabling Test Mode**:
```javascript
// Method 1: Boolean parameter
const response = await puter.ai.chat("Hello", true);

// Method 2: Object parameter
const response = await puter.ai.chat("Hello", { testMode: true });

// Method 3: With vision
const response = await puter.ai.chat("Describe this", imageFile, true);
```

**Test Mode Behavior**:
- Bypasses actual API calls to external providers
- Returns mock responses for development/testing
- Does not count against usage limits
- Useful for integration testing and development
- Automatically sets `test_mode: true` in backend requests

#### Function Signature Detection

The `puter.ai.chat()` method automatically detects the input format and processes parameters accordingly:

**Parameter Detection Logic**:
1. **String + Boolean**: `chat(prompt, true)` → Text with test mode
2. **String + File/String**: `chat(prompt, image)` → Vision with single image
3. **String + File/String + Boolean**: `chat(prompt, image, true)` → Vision with test mode
4. **String + Array**: `chat(prompt, [image1, image2])` → Vision with multiple images
5. **Array**: `chat([messages])` → Conversation array or simple strings
6. **Object**: `chat({ messages, model, ... })` → Full parameter object

**Simple Message Conversion**:
- `chat(["hi"])` → Automatically converted to `[{ content: "hi" }]`
- `chat(["Hello", "How are you?"])` → Converted to `[{ content: "Hello" }, { content: "How are you?" }]`

**Parameter Merging**:
- User parameters in object form are merged with detected parameters
- Vision detection automatically sets `vision: true` when images are present
- Test mode can be specified in multiple ways and is automatically detected
- Model mapping and driver selection happen automatically

**Example of Complex Detection**:
```javascript
// This automatically detects:
// - Vision mode (due to image parameter)
// - Test mode (due to boolean parameter)
// - Maps to appropriate driver based on model
const response = await puter.ai.chat(
  "Describe this image", 
  imageFile, 
  true, 
  { model: "claude-3-opus" }
);
```

---

## Image Generation

### Overview

Generate images from text descriptions using AI models like DALL-E. Supports various image qualities and aspect ratios.

### Interface: `puter-image-generation`

#### Method: `generate`

**Summary**: Create an image from a text prompt using AI image generation models.

**Description**: Generate an image from a prompt.

**Parameters**:
- `prompt` (type: `string`, required): Text description of the desired image
- `quality` (type: `string`, optional): Image quality setting

**Result**: URL of the generated image.

**Result Choices**:
- `image`: Stream with content_type: 'image'
- `url`: String URL with content_type: 'image'

#### puter.js Usage

```javascript
// Generate image from text
const image = await puter.ai.txt2img("A beautiful sunset over mountains");

// Access the image
console.log(image.src); // Image URL
```

#### Backend HTTP API

**Endpoint**: `POST /drivers/call`

**Request**:
```json
{
  "interface": "puter-image-generation",
  "method": "generate",
  "args": {
    "prompt": "A beautiful sunset over mountains"
  }
}
```

**Response**: Image blob with `Content-Type: image/*`

---

## Text-to-Speech

### Overview

Convert text into natural-sounding speech using various TTS engines and voices.

### Interface: `puter-tts`

#### Method: `synthesize`

**Summary**: Convert text to speech using specified voice and engine.

**Description**: Synthesize speech from text.

**Parameters**:
- `text` (type: `string`, required): Text to convert to speech
- `voice` (type: `string`, required): Voice identifier
- `language` (type: `string`, optional): Language code
- `ssml` (type: `flag`, optional): Enable SSML markup
- `engine` (type: `string`, optional): TTS engine to use

**Result Choices**:
- `audio`: Stream with content_type: 'audio'

#### puter.js Usage

```javascript
// Convert text to speech
const audio = await puter.ai.txt2speech("Hello world", "en-US-Standard-A");

// Play the audio
audio.play();
```

#### Backend HTTP API

**Endpoint**: `POST /drivers/call`

**Request**:
```json
{
  "interface": "puter-tts",
  "method": "synthesize",
  "args": {
    "text": "Hello world",
    "voice": "en-US-Standard-A"
  }
}
```

**Response**: Audio stream with `Content-Type: audio/*`

---

## Model Management

### Overview

Discover and manage available AI models across different providers and capabilities.

### Interface: `puter-chat-completion`

#### Method: `list`

**Summary**: Get a list of available AI models.

**Description**: List supported models.

**Parameters**: None

**Result**: Array of model identifiers (strings)

#### puter.js Usage

**Model Management**:
```javascript
// List available models
const models = await puter.ai.listModels();

// List models by provider
const openaiModels = await puter.ai.listModels("openai");
const claudeModels = await puter.ai.listModels("claude");

// Get model providers
const providers = await puter.ai.listModelProviders();
```

#### Backend HTTP API

**Endpoint**: `POST /drivers/call`

**Request**:
```json
{
  "interface": "puter-chat-completion",
  "method": "list"
}
```

**Response**:
```json
{
  "success": true,
  "result": [
    "gpt-4o",
    "gpt-3.5-turbo",
    "claude-3-opus",
    "claude-3-sonnet"
  ]
}
```

#### Method: `models`

**Summary**: Get detailed information about available models including pricing and capabilities.

**Description**: List supported models and their details.

**Parameters**: None

**Result**: JSON array with detailed model information including:
- `id`: Model identifier
- `provider`: Service provider name
- `aliases`: Alternative names for the model
- `context_length`: Maximum context length
- `capabilities`: Available features
- `pricing`: Cost information

#### puter.js Usage

```javascript
// Get detailed model information
const modelDetails = await puter.ai.listModels();
```

#### Backend HTTP API

**Endpoint**: `POST /drivers/call`

**Request**:
```json
{
  "interface": "puter-chat-completion",
  "method": "models"
}
```

**Response**:
```json
{
  "success": true,
  "result": [
    {
      "id": "gpt-4o",
      "provider": "openai",
      "aliases": ["gpt4o"],
      "context_length": 128000,
      "capabilities": ["chat", "vision"],
      "pricing": {
        "input": 0.000005,
        "output": 0.000015
      }
    }
  ]
}
```

---

## Common Patterns

### AI Model Naming and Mapping

**Scope**: This rule applies to `model` field in AI-related API endpoints. Such as:
- `puter-chat-completion/complete`

**Request Format**:
- interface (type: string, required) (`"puter-chat-completion"`)
- method (type: string, required) (`"complete"`)
- driver (type: string, optional) (auto-detected based on model)
- args
  - model (type: string, required) (e.g., `"gpt-4o"`, `"claude-3-opus"`, `"gemini-1.5-flash"`)
  - messages (type: array, required)
    - (e.g., `["Hello! How are you?"]`)
    - (e.g., `[{ content: "Hello! How are you?" }]`)

**Model Format Support**: Multiple formats are supported:
- `<model-name>` (e.g., `gpt-4o`, `claude-3-opus`)
- `<vendor>/<model-name>` (e.g., `openai/gpt-4o`, `anthropic/claude-3-opus`)
- `<supplier>:<vendor>/<model-name>` (e.g., `azure:openai/gpt-4o`)

**Automatic Model Mapping**: The system automatically maps models to appropriate drivers:

**OpenAI Models** → `openai-completion` driver:
- `gpt-*` models (gpt-4o, gpt-3.5-turbo, etc.)
- `openai/*` prefix is automatically removed
- Examples: `gpt-4o`, `openai/gpt-4o` → both use OpenAI driver

**Claude Models** → `claude` driver:
- `claude-*` models
- `anthropic/*` prefix is automatically removed
- Model aliases: `claude` → `claude-3-7-sonnet-latest`

**Gemini Models** → `gemini` driver:
- `gemini-1.5-flash`, `gemini-2.0-flash`

**Groq Models** → `groq` driver:
- `mistral` → `mistral-large-latest`
- `groq` → `llama3-8b-8192`
- Various Llama models

**OpenRouter Models** → `openrouter` driver:
- `openrouter:*` prefix
- Meta Llama, Google, DeepSeek, x-AI models automatically prefixed
- Examples: `meta-llama/Llama-3.1-8B-Instruct-Turbo` → `openrouter:meta-llama/Llama-3.1-8B-Instruct-Turbo`

**Special Model Mappings**:
- `o1-mini` → `openrouter:openai/o1-mini`
- `deepseek` → `deepseek-chat`
- `mistral` → `mistral-large-latest`

### Driver Implementations

The following services implement the `puter-chat-completion` interface:

- **`ai-chat`**: Main AI chat service with fallback and provider selection
- **`openai-completion`**: OpenAI API integration (GPT models)
- **`claude`**: Anthropic Claude API integration
- **`gemini`**: Google Gemini API integration
- **`groq`**: Groq API integration (Llama models)
- **`deepseek`**: DeepSeek API integration
- **`xai`**: xAI Grok integration
- **`openrouter`**: OpenRouter API integration (multiple providers)

### Error Handling

All API responses use HTTP 200 status. Check the `success` field in the response body:

**Error Response Format**:
```json
{
  "success": false,
  "error": {
    "code": "error_code",
    "message": "Human-readable description"
  }
}
```

**Common Error Codes**:
- `permission_denied`: User lacks permission to use the driver
- `rate_limit_exceeded`: API rate limit exceeded
- `usage_limit_exceeded`: User usage limit exceeded
- `invalid_model`: Specified model is not available
- `invalid_parameters`: Request parameters are invalid
- `provider_error`: Error from the underlying AI provider
- `moderation_error`: Content flagged by moderation systems

### Streaming Responses

When `stream: true` is specified, the response is returned as a stream with the following format:

**Response Headers**:
- `Content-Type: application/ndjson`
- `Transfer-Encoding: chunked` (if applicable)

**Response Body**: Newline-delimited JSON stream
```json
{"role": "assistant", "content": "Hello"}
{"role": "assistant", "content": "! How"}
{"role": "assistant", "content": " can I help"}
{"role": "assistant", "content": " you today?"}
```

### Usage Tracking

All chat completions are tracked for:
- Token usage (prompt, completion, total)
- Cost calculation based on provider pricing
- Rate limiting and quota management
- User analytics and billing

### Testing Mode

Set `test_mode: true` in the request to enable testing mode, which:
- Bypasses actual API calls to external providers
- Returns mock responses for development/testing
- Does not count against usage limits
- Useful for integration testing and development

### Security and Permissions

- **Authentication**: All requests require valid authentication
- **Permissions**: Users must have permission to use specific driver interfaces
- **Moderation**: Content is automatically checked against moderation policies
- **Rate Limiting**: Requests are rate-limited per user and per provider
- **Usage Limits**: Users are subject to usage limits based on their plan
