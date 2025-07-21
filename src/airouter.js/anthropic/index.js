import { ASYNC_RESPONSE, COMPLETION_WRITER, NORMALIZED_LLM_PARAMS, NORMALIZED_LLM_TOOLS, PROVIDER_NAME, STREAM, SYNC_RESPONSE, USAGE_WRITER } from "../common/types.js";

import { NormalizedPromptUtil } from '../common/prompt/NormalizedPromptUtil.js';
import Anthropic from "@anthropic-ai/sdk";

import { betas } from "./consts.js";
import handle_files from "./handle_files.js";
import write_to_stream from "./write_to_stream.js";

export const ANTHROPIC_LLM_INPUT = Symbol('ANTHROPIC_LLM_INPUT');
export const ANTHROPIC_LLM_PARAMS = Symbol('ANTHROPIC_LLM_PARAMS');
export const ANTHROPIC_LLM_TOOLS = Symbol('ANTHROPIC_LLM_TOOLS');
export const ANTHROPIC_API_KEY = Symbol('ANTHROPIC_API_KEY');
export const ANTHROPIC_CLIENT = Symbol('ANTHROPIC_CLIENT');

export default define => {
    // Define how to get parameters for the Anthropic client
    define.howToGet(ANTHROPIC_LLM_PARAMS).from(NORMALIZED_LLM_PARAMS)
    .as(async x => {
        const params = x.get(NORMALIZED_LLM_PARAMS);
        params.tools = await x.obtain(ANTHROPIC_LLM_TOOLS, {
            [NORMALIZED_LLM_TOOLS]: params.tools,
        });
        
        let system_prompts;
        [system_prompts, params.messages] = NormalizedPromptUtil.extract_and_remove_system_messages(params.messages);
        
        if ( ! x.memo.cleanups ) x.memo.cleanups = [];
        await handle_files({
            client: await x.obtain(ANTHROPIC_CLIENT),
            cleanups: x.memo.cleanups,
            messages: params.messages
        });
        
        return {
            model: params.model,
            max_tokens: Math.floor(params.max_tokens) ||
                ((
                    params.model === 'claude-3-5-sonnet-20241022'
                    || params.model === 'claude-3-5-sonnet-20240620'
                ) ? 8192 : 4096), //required
            temperature: params.temperature || 0, // required
            ...(system_prompts ? {
                system: system_prompts.length > 1
                    ? JSON.stringify(system_prompts)
                    : JSON.stringify(system_prompts[0])
            } : {}),
            messages: params.messages,
            ...(params.tools ? { tools: params.tools } : {}),
            betas,
        };
    });
    
    // Define how to get tools in the format expected by Anthropic
    define.howToGet(ANTHROPIC_LLM_TOOLS).from(NORMALIZED_LLM_TOOLS)
    .as(async x => {
        const tools = x.get(NORMALIZED_LLM_TOOLS);
        if ( ! tools ) return undefined;
        return tools.map(tool => {
            const { name, description, parameters } = tool.function;
            return {
                name,
                description,
                input_schema: parameters,
            };
        });
    });
    
    define.howToGet(ANTHROPIC_CLIENT).from(ANTHROPIC_API_KEY).as(async x => {
        let client = new Anthropic({
            apiKey: await x.obtain(ANTHROPIC_API_KEY),
        });
        return client.beta;
    });
    
    define.howToGet(ASYNC_RESPONSE).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) == 'anthropic')
    .as(async x => {
        const anthropic_params = await x.obtain(ANTHROPIC_LLM_PARAMS, {
            [NORMALIZED_LLM_PARAMS]: x.get(NORMALIZED_LLM_PARAMS),
        });
        let client = await x.obtain(ANTHROPIC_CLIENT);
        
        const anthropicStream = await client.messages.stream(anthropic_params);
        
        const completionWriter = x.get(COMPLETION_WRITER);
        await write_to_stream({
            input: anthropicStream,
            completionWriter,
            usageWriter: x.get(USAGE_WRITER) ?? { resolve: () => {} },
        });
        if ( x.memo?.cleanups ) await Promise.all(x.memo.cleanups);
    });
    
    define.howToGet(SYNC_RESPONSE).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) == 'anthropic')
    .as(async x => {
        const anthropic_params = await x.obtain(ANTHROPIC_LLM_PARAMS, {
            [NORMALIZED_LLM_PARAMS]: x.get(NORMALIZED_LLM_PARAMS),
        });
        let client = await x.obtain(ANTHROPIC_CLIENT);
        
        const msg = await client.messages.create(anthropic_params);
        
        if ( x.memo?.cleanups ) await Promise.all(x.memo.cleanups);
        
        return {
            message: msg,
            usage: msg.usage,
            finish_reason: 'stop',
        };
    })
};
