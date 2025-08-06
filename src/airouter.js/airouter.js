import { Registry } from './core/Registry.js';


const registry = new Registry();
const define = registry.getDefineAPI();

import convenienceRegistrants from './common/convenience.js';
convenienceRegistrants(define);

import commonRegistrants from './common/index.js';
commonRegistrants(define);

import anthropicRegistrants from './anthropic/index.js';
anthropicRegistrants(define);

import openaiRegistrants from './openai/index.js';
openaiRegistrants(define);

export const obtain = registry.getObtainAPI();

export * from './common/types.js';

// Streaming Utilities
export { CompletionWriter } from './common/stream/CompletionWriter.js';
export { MessageWriter } from './common/stream/MessageWriter.js';
export { ToolUseWriter } from './common/stream/ToolUseWriter.js';
export { TextWriter } from './common/stream/TextWriter.js';
export { BaseWriter } from './common/stream/BaseWriter.js';

// Common prompt processing
export { NormalizedPromptUtil } from './common/prompt/NormalizedPromptUtil.js';
export { UniversalToolsNormalizer } from './common/prompt/UniversalToolsNormalizer.js';

// Conventional Processing
export { OpenAIStyleMessagesAdapter } from './convention/openai/OpenAIStyleMessagesAdapter.js';
export { OpenAIStyleStreamAdapter } from './convention/openai/OpenAIStyleStreamAdapter.js';

// Model-Specific Processing
export { OpenAIToolsAdapter } from './openai/OpenAIToolsAdapter.js';
export { GeminiToolsAdapter } from './gemini/GeminiToolsAdapter.js';

// API Keys
export { ANTHROPIC_API_KEY } from './anthropic/index.js';
export { OPENAI_CLIENT } from './openai/index.js';

import openai_models from './models/openai.json' with { type: 'json' };
export const models = {
    openai: openai_models,
};
