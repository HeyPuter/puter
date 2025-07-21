import openai_models from '../models/openai.json' with { type: 'json' };
import { ASYNC_RESPONSE, COERCED_MESSAGES, COERCED_PARAMS, COERCED_TOOLS, COERCED_USAGE, COMPLETION_WRITER, MODEL_DETAILS, NORMALIZED_LLM_MESSAGES, NORMALIZED_LLM_PARAMS, NORMALIZED_LLM_TOOLS, PROVIDER_NAME, STREAM_WRITTEN_TO_COMPLETION_WRITER, SYNC_RESPONSE, USAGE_WRITER } from "../common/types.js";
import handle_files from './handle_files.js';
import { TransformUsageWriter } from '../common/usage/TransformUsageWriter.js';
import { OpenAIStreamAdapter } from './OpenAIStreamAdapter.js';

export const OPENAI_CLIENT = Symbol('OPENAI_CLIENT');
export const OPENAI_USAGE = Symbol('OPENAI_USAGE');

export default define => {
    define.howToGet(COERCED_PARAMS).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) == 'openai')
    .as(async x => {
        const params = x.get(NORMALIZED_LLM_PARAMS);
        params.tools = await x.obtain(COERCED_TOOLS);
        params.messages = await x.obtain(COERCED_MESSAGES);
        
        return {
            user: params.user_id,
            messages: params.messages,
            model: params.model,
            ...(params.tools ? { tools: params.tools } : {}),
            ...(params.max_tokens ? { max_completion_tokens: params.max_tokens } : {}),
            ...(params.temperature ? { temperature: params.temperature } : {}),
            // TODO: move as assign on stream getter
            // stream: is_stream,
            // ...(is_stream ? {
            //     stream_options: { include_usage: true },
            // } : {}),
        };
    });
    
    define.howToGet(COERCED_TOOLS).from(NORMALIZED_LLM_TOOLS)
    .provided(x => x.get(PROVIDER_NAME) == 'openai')
    .as(async x => {
        // Normalized tools follow OpenAI's format, so no coercion is required
        return x.get(NORMALIZED_LLM_TOOLS);
    })
    
    define.howToGet(COERCED_USAGE).from(OPENAI_USAGE, MODEL_DETAILS)
    .as(async x => {
        const openai_usage = x.get(OPENAI_USAGE);
        const model_details = x.get(MODEL_DETAILS);
        const standard_usage = [];

        standard_usage.push({
            type: 'prompt',
            model: model_details.id,
            amount: openai_usage.prompt_tokens,
            cost: model_details.cost.input * openai_usage.prompt_tokens,
        });
        standard_usage.push({
            type: 'completion',
            model: model_details.id,
            amount: openai_usage.completion_tokens,
            cost: model_details.cost.output * openai_usage.completion_tokens,
        });
        
        return standard_usage;
    })
    
    define.howToGet(ASYNC_RESPONSE).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) == 'openai')
    .as(async x => {
        const params = await x.obtain(COERCED_PARAMS);
        params.stream = true;
        params.stream_options = { include_usage: true };

        const client = await x.obtain(OPENAI_CLIENT);
        const model_details = openai_models.find(entry => entry.id === params.model);

        const stream = await client.chat.completions.create({
            ...params,
        });
        
        await OpenAIStreamAdapter.write_to_stream({
            input: stream,
            completionWriter: x.get(COMPLETION_WRITER),
            usageWriter: new TransformUsageWriter(async usage => {
                return await x.obtain(COERCED_USAGE, {
                    [OPENAI_USAGE]: usage,
                    [MODEL_DETAILS]: model_details,
                });
            }, x.get(USAGE_WRITER)),
        });
    });
    
    define.howToGet(SYNC_RESPONSE).from(NORMALIZED_LLM_PARAMS)
    .provided(x => x.get(PROVIDER_NAME) == 'openai')
    .as(async x => {
        const params = await x.obtain(COERCED_PARAMS);

        const client = await x.obtain(OPENAI_CLIENT);
        const model_details = openai_models.find(entry => entry.id === params.model);
        const completion = await client.chat.completions.create(params);
        
        const ret = completion.choices[0];
        
        ret.usage = await x.obtain(COERCED_USAGE, {
            [OPENAI_USAGE]: completion.usage,
            [MODEL_DETAILS]: model_details,
        });

        return ret;
    });
    
    define.howToGet(COERCED_MESSAGES).from(NORMALIZED_LLM_MESSAGES)
    .provided(x => x.get(PROVIDER_NAME) == 'openai')
    .as(async x => {
        let messages = x.get(NORMALIZED_LLM_MESSAGES);
        
        await handle_files({ messages });
        
        for ( const msg of messages ) {
            if ( ! msg.content ) continue;
            if ( typeof msg.content !== 'object' ) continue;

            const content = msg.content;

            for ( const o of content ) {
                if ( ! o.hasOwnProperty('image_url') ) continue;
                if ( o.type ) continue;
                o.type = 'image_url';
            }

            // coerce tool calls
            let is_tool_call = false;
            for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
                const content_block = content[i];

                if ( content_block.type === 'tool_use' ) {
                    if ( ! msg.hasOwnProperty('tool_calls') ) {
                        msg.tool_calls = [];
                        is_tool_call = true;
                    }
                    msg.tool_calls.push({
                        id: content_block.id,
                        type: 'function',
                        function: {
                            name: content_block.name,
                            arguments: JSON.stringify(content_block.input),
                        }
                    });
                    content.splice(i, 1);
                }
            }

            if ( is_tool_call ) msg.content = null;

            // coerce tool results
            // (we assume multiple tool results were already split into separate messages)
            for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
                const content_block = content[i];
                if ( content_block.type !== 'tool_result' ) continue;
                msg.role = 'tool';
                msg.tool_call_id = content_block.tool_use_id;
                msg.content = content_block.content;
            }
        }
        
        return messages;
    })
};
