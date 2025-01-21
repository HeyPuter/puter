# PuterAIModule

PuterAIModule class extends AdvancedBase to manage and register various AI services.
This module handles the initialization and registration of multiple AI-related services
including text processing, speech synthesis, chat completion, and image generation.
Services are conditionally registered based on configuration settings, allowing for
flexible deployment with different AI providers like AWS, OpenAI, Claude, Together AI,
Mistral, Groq, and XAI.

## Services

### AIChatService

AIChatService class extends BaseService to provide AI chat completion functionality.
Manages multiple AI providers, models, and fallback mechanisms for chat interactions.
Handles model registration, usage tracking, cost calculation, content moderation,
and implements the puter-chat-completion driver interface. Supports streaming responses
and maintains detailed model information including pricing and capabilities.

#### Listeners

##### `boot.consolidation`

Handles consolidation during service boot by registering service aliases
and populating model lists/maps from providers.

Registers each provider as an 'ai-chat' service alias and fetches their
available models and pricing information. Populates:
- simple_model_list: Basic list of supported models
- detail_model_list: Detailed model info including costs
- detail_model_map: Maps model IDs/aliases to their details

#### Methods

##### `register_provider`



##### `moderate`

Moderates chat messages for inappropriate content using OpenAI's moderation service

###### Parameters

- **params:** The parameters object
- **params.messages:** Array of chat messages to moderate

##### `get_delegate`

Gets the appropriate delegate service for handling chat completion requests.
If the intended service is this service (ai-chat), returns undefined.
Otherwise returns the intended service wrapped as a puter-chat-completion interface.

##### `get_fallback_model`

Find an appropriate fallback model by sorting the list of models
by the euclidean distance of the input/output prices and selecting
the first one that is not in the tried list.

###### Parameters

- **param0:** null

##### `get_model_from_request`



### AIInterfaceService

Service class that manages AI interface registrations and configurations.
Handles registration of various AI services including OCR, chat completion,
image generation, and text-to-speech interfaces. Each interface defines
its available methods, parameters, and expected results.

#### Listeners

##### `driver.register.interfaces`

Service class for managing AI interface registrations and configurations.
Extends the base service to provide AI-related interface management.
Handles registration of OCR, chat completion, image generation, and TTS interfaces.

### AITestModeService

Service class that handles AI test mode functionality.
Extends BaseService to register test services for AI chat completions.
Used for testing and development of AI-related features by providing
a mock implementation of the chat completion service.

### AWSPollyService

AWSPollyService class provides text-to-speech functionality using Amazon Polly.
Extends BaseService to integrate with AWS Polly for voice synthesis operations.
Implements voice listing, speech synthesis, and voice selection based on language.
Includes caching for voice descriptions and supports both text and SSML inputs.

#### Methods

##### `describe_voices`

Describes available AWS Polly voices and caches the results

##### `synthesize_speech`

Synthesizes speech from text using AWS Polly

###### Parameters

- **text:** The text to synthesize
- **options:** Synthesis options
- **options.format:** Output audio format (e.g. 'mp3')

### AWSTextractService

AWSTextractService class - Provides OCR (Optical Character Recognition) functionality using AWS Textract
Extends BaseService to integrate with AWS Textract for document analysis and text extraction.
Implements driver capabilities and puter-ocr interface for document recognition.
Handles both S3-stored and buffer-based document processing with automatic region management.

#### Methods

##### `analyze_document`

Analyzes a document using AWS Textract to extract text and layout information

###### Parameters

- **file_facade:** Interface to access the document file

### ClaudeEnoughService

ClaudeEnoughService - A service class that implements a Claude-like AI interface
Extends XAIService to provide Claude-compatible responses while using alternative AI models.
Includes custom system prompts and model adaptation to simulate Claude's behavior
in the Puter platform's chat completion interface.

#### Methods

##### `get_system_prompt`

Service that emulates Claude's behavior using alternative AI models

##### `adapt_model`



### ClaudeService

ClaudeService class extends BaseService to provide integration with Anthropic's Claude AI models.
Implements the puter-chat-completion interface for handling AI chat interactions.
Manages message streaming, token limits, model selection, and API communication with Claude.
Supports system prompts, message adaptation, and usage tracking.

#### Methods

##### `get_default_model`

Returns the default model identifier for Claude API interactions

### FakeChatService

FakeChatService - A mock implementation of a chat service that extends BaseService.
Provides fake chat completion responses using Lorem Ipsum text generation.
Used for testing and development purposes when a real chat service is not needed.
Implements the 'puter-chat-completion' interface with list() and complete() methods.

### GroqAIService

Service class for integrating with Groq AI's language models.
Extends BaseService to provide chat completion capabilities through the Groq API.
Implements the puter-chat-completion interface for model management and text generation.
Supports both streaming and non-streaming responses, handles multiple models including
various versions of Llama, Mixtral, and Gemma, and manages usage tracking.

#### Methods

##### `get_default_model`

Returns the default model ID for the Groq AI service

### MistralAIService

MistralAIService class extends BaseService to provide integration with the Mistral AI API.
Implements chat completion functionality with support for various Mistral models including
mistral-large, pixtral, codestral, and ministral variants. Handles both streaming and
non-streaming responses, token usage tracking, and model management. Provides cost information
for different models and implements the puter-chat-completion interface.

#### Methods

##### `get_default_model`

Populates the internal models array with available Mistral AI models and their metadata
Fetches model data from the API, filters based on cost configuration, and stores
model objects containing ID, name, aliases, context length, capabilities, and pricing

### OpenAICompletionService

OpenAICompletionService class provides an interface to OpenAI's chat completion API.
Extends BaseService to handle chat completions, message moderation, token counting,
and streaming responses. Implements the puter-chat-completion interface and manages
OpenAI API interactions with support for multiple models including GPT-4 variants.
Handles usage tracking, spending records, and content moderation.

#### Methods

##### `get_default_model`

Gets the default model identifier for OpenAI completions

##### `check_moderation`

Checks text content against OpenAI's moderation API for inappropriate content

###### Parameters

- **text:** The text content to check for moderation

##### `complete`

Completes a chat conversation using OpenAI's API

###### Parameters

- **messages:** Array of message objects or strings representing the conversation
- **options:** Configuration options
- **options.stream:** Whether to stream the response
- **options.moderation:** Whether to perform content moderation
- **options.model:** The model to use for completion

### OpenAIImageGenerationService

Service class for generating images using OpenAI's DALL-E API.
Extends BaseService to provide image generation capabilities through
the puter-image-generation interface. Supports different aspect ratios
(square, portrait, landscape) and handles API authentication, request
validation, and spending tracking.

#### Methods

##### `generate`



### TogetherAIService

TogetherAIService class provides integration with Together AI's language models.
Extends BaseService to implement chat completion functionality through the
puter-chat-completion interface. Manages model listings, chat completions,
and streaming responses while handling usage tracking and model fallback testing.

#### Methods

##### `get_default_model`

Returns the default model ID for the Together AI service

### XAIService

XAIService class - Provides integration with X.AI's API for chat completions
Extends BaseService to implement the puter-chat-completion interface.
Handles model management, message adaptation, streaming responses,
and usage tracking for X.AI's language models like Grok.

#### Methods

##### `get_system_prompt`

Gets the system prompt used for AI interactions

##### `adapt_model`



##### `get_default_model`

Returns the default model identifier for the XAI service

## Notes

### Outside Imports

This module has external relative imports. When these are
removed it may become possible to move this module to an
extension.

**Imports:**
- `../../api/APIError`
- `../../services/auth/PermissionService`
- `../../services/BaseService` (use.BaseService)
- `../../services/database/consts`
- `../../services/drivers/meta/Construct`
- `../../services/drivers/meta/Runtime`
- `../../util/context`
- `../../services/BaseService` (use.BaseService)
- `../../services/BaseService` (use.BaseService)
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../services/BaseService` (use.BaseService)
- `../../api/APIError`
- `../../services/BaseService` (use.BaseService)
- `../../util/langutil`
- `../../services/drivers/meta/Runtime`
- `../../api/APIError`
- `../../util/promise`
- `../../services/BaseService` (use.BaseService)
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../util/langutil`
- `../../util/promise`
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../util/langutil`
- `../../util/promise`
- `../../api/APIError`
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../util/context`
- `../../util/smolutil`
- `../../util/langutil`
- `../../util/promise`
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../util/context`
- `../../config`
- `../../services/BaseService` (use.BaseService)
- `../../services/drivers/meta/Runtime`
- `../../util/langutil`
- `../../util/promise`
- `../../services/BaseService` (use.BaseService)
- `../../util/langutil`
- `../../services/drivers/meta/Runtime`
- `../../util/promise`
