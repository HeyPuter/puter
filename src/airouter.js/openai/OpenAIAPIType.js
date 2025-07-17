import { NormalizedPromptUtil } from '../airouter.js';
import { TransformUsageWriter } from '../common/usage/TransformUsageWriter.js';
import { stream_to_buffer } from '../common/util/streamutil.js';
import { OpenAIStreamAdapter } from './OpenAIStreamAdapter.js';
import { OpenAIToolsAdapter } from './OpenAIToolsAdapter.js';

import models from './models.json' with { type: 'json' };

const MAX_FILE_SIZE = 5 * 1_000_000;

export class OpenAIInvocation {
    constructor ({ client, sdk_params, model_details }) {
        this.client = client;
        this.sdk_params = sdk_params;
        this.model_details = model_details;
    }
    
    coerce_to_standard_usage_ (openai_usage) {
        const model_list = models;
        const model_details = model_list.find(entry => entry.id === this.sdk_params.model);
        
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
    }
}

export class OpenAIStreamInvocation extends OpenAIInvocation {
    /**
     * 
     * @param {Object} params
     * @param {import('@anthropic-ai/sdk').Anthropic} params.client
     * @param {import('../common/stream/CompletionWriter').CompletionWriter} params.completionWriter
     */
    constructor ({ client, sdk_params, model_details, usageWriter, completionWriter, cleanups }) {
        super({ client, sdk_params, model_details });
        this.client = client;
        this.sdk_params = sdk_params;
        this.usageWriter = usageWriter;
        this.completionWriter = completionWriter;
        this.cleanups = cleanups ?? [];
    }
    async run () {
        const stream = await this.client.chat.completions.create({
            ...this.sdk_params,
            stream: true,
        });
        await OpenAIStreamAdapter.write_to_stream({
            input: stream,
            completionWriter: this.completionWriter,
            usageWriter: new TransformUsageWriter(usage => {
                return this.coerce_to_standard_usage_(usage);
            }, this.usageWriter),
        });
    }
    async cleanup () {
        // NOOP
    }
}

export class OpenAISyncInvocation extends OpenAIInvocation {
    /**
     * 
     * @param {Object} params
     * @param {import('@anthropic-ai/sdk').Anthropic} params.client
     * @param {import('../common/stream/CompletionWriter').CompletionWriter} params.completionWriter
     */
    constructor ({ client, sdk_params, model_details, cleanups }) {
        super({ client, sdk_params, model_details });
        this.client = client;
        this.sdk_params = sdk_params;
        this.cleanups = cleanups ?? [];
    }
    async run () {
        const completion = await this.client.chat.completions.create(this.sdk_params);
        
        const ret = completion.choices[0];
        
        ret.usage = this.coerce_to_standard_usage_(completion.usage);

        return ret;
    }
    async cleanup () {
        // NOOP
    }
}

export class OpenAIAPIType {
    async stream (client, completionWriter, options) {
        await this.handle_files_({ messages: options.messages });
        const sdk_params = this.create_sdk_params_(options);

        const model_list = models;
        const model_details = model_list.find(entry => entry.id === sdk_params.model);
        
        const usageWriter = options.usageWriter ?? { resolve: () => {} };
        
        return new OpenAIStreamInvocation({
            client,
            sdk_params,
            model_details,
            usageWriter,
            completionWriter,
        });
    }
    async create (client, options) {
        await this.handle_files_({ messages: options.messages });
        const sdk_params = this.create_sdk_params_(options, false);

        const model_list = models;
        const model_details = model_list.find(entry => entry.id === sdk_params.model);
        
        return new OpenAISyncInvocation({
            client,
            sdk_params,
            model_details,
        });
    }
    
    create_sdk_params_ (options, is_stream) {
        options.tools = OpenAIToolsAdapter.adapt_tools(options.tools);
        
        let system_prompts;
        [system_prompts, options.messages] = NormalizedPromptUtil.extract_and_remove_system_messages(options.messages);
        
        return {
            user: options.user_id,
            messages: options.messages,
            model: options.model,
            ...(options.tools ? { tools: options.tools } : {}),
            ...(options.max_tokens ? { max_completion_tokens: options.max_tokens } : {}),
            ...(options.temperature ? { temperature: options.temperature } : {}),
            stream: is_stream,
            ...(is_stream ? {
                stream_options: { include_usage: true },
            } : {}),
        };
    }

    async handle_files_ ({ messages }) {
        const file_input_tasks = [];
        for ( const message of messages ) {
            // We can assume `message.content` is not undefined because
            // UniversalPromptNormalizer ensures this.
            for ( const contentPart of message.content ) {
                if ( contentPart.type !== 'data' ) continue;
                const { data } = contentPart;
                delete contentPart.data;
                file_input_tasks.push({
                    data,
                    contentPart,
                });
            }
        }
        
        const promises = [];
        for ( const task of file_input_tasks ) promises.push((async () => {
            if ( await task.data.getSize() > MAX_FILE_SIZE ) {
                delete task.contentPart.puter_path;
                task.contentPart.type = 'text';
                task.contentPart.text = `{error: input file exceeded maximum of ${MAX_FILE_SIZE} bytes; ` +
                    `the user did not write this message}`; // "poor man's system prompt"
                return; // "continue"
            }
            
            const stream = await task.data.getStream();
            const mimeType = await task.data.getMimeType();
            
            const buffer = await stream_to_buffer(stream);
            const base64 = buffer.toString('base64');
            
            delete task.contentPart.puter_path;
            if ( mimeType.startsWith('image/') ) {
                task.contentPart.type = 'image_url',
                task.contentPart.image_url = {
                    url: `data:${mimeType};base64,${base64}`,
                };
            } else if ( mimeType.startsWith('audio/') ) {
                task.contentPart.type = 'input_audio',
                task.contentPart.input_audio = {
                    data: `data:${mimeType};base64,${base64}`,
                    format: mimeType.split('/')[1],
                }
            } else {
                task.contentPart.type = 'text';
                task.contentPart.text = `{error: input file has unsupported MIME type; ` +
                    `the user did not write this message}`; // "poor man's system prompt"
            }
        })());
        await Promise.all(promises);
    }
}