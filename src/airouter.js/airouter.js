import { AnthropicAPIType } from './anthropic/AnthropicAPIType.js';
import { LLMRegistry } from './router/LLMRegistry.js';

// Streaming Utilities
export { CompletionWriter } from './common/stream/CompletionWriter.js';
export { MessageWriter } from './common/stream/MessageWriter.js';
export { ToolUseWriter } from './common/stream/ToolUseWriter.js';
export { TextWriter } from './common/stream/TextWriter.js';
export { BaseWriter } from './common/stream/BaseWriter.js';

// Common prompt processing
export { UniversalPromptNormalizer } from './common/prompt/UniversalPromptNormalizer.js';
export { NormalizedPromptUtil } from './common/prompt/NormalizedPromptUtil.js';
export { UniversalToolsNormalizer } from './common/prompt/UniversalToolsNormalizer.js';

// Conventional Processing
export { OpenAIStyleMessagesAdapter } from './convention/openai/OpenAIStyleMessagesAdapter.js';
export { OpenAIStyleStreamAdapter } from './convention/openai/OpenAIStyleStreamAdapter.js';

// Model-Specific Processing
export { AnthropicToolsAdapter } from './anthropic/AnthropicToolsAdapter.js';
export { OpenAIToolsAdapter } from './openai/OpenAIToolsAdapter.js';
export { GeminiToolsAdapter } from './gemini/GeminiToolsAdapter.js';

// Model-Specific Output Adaptation
export { AnthropicStreamAdapter } from './anthropic/AnthropicStreamAdapter.js';
export { AnthropicAPIType } from './anthropic/AnthropicAPIType.js';

export { OpenAIAPIType } from './openai/OpenAIAPIType.js';

import openai_models from './models/openai.json' with { type: 'json' };
export const models = {
    openai: openai_models,
};

export class AIRouter extends LLMRegistry {
    constructor () {
        super();
        this.registerApiType('claude', new AnthropicAPIType());
    }
}
