import { AnthropicStreamAdapter } from "./AnthropicStreamAdapter.js";
import { AnthropicToolsAdapter } from "./AnthropicToolsAdapter.js";
import { NormalizedPromptUtil } from "../common/prompt/NormalizedPromptUtil.js";
import { PassThrough } from 'node:stream';

const FILES_API_BETA_STRING = 'files-api-2025-04-14';

export class AnthropicAPIStreamInvocation {
    /**
     * 
     * @param {Object} params
     * @param {import('@anthropic-ai/sdk').Anthropic} params.client
     * @param {import('../common/stream/CompletionWriter').CompletionWriter} params.completionWriter
     */
    constructor ({ client, sdk_params, usageWriter, completionWriter, cleanups }) {
        this.client = client;
        this.sdk_params = sdk_params;
        this.usageWriter = usageWriter;
        this.completionWriter = completionWriter;
        this.cleanups = cleanups ?? [];
    }
    async run () {
        const anthropicStream = await this.client.messages.stream(this.sdk_params);
        await AnthropicStreamAdapter.write_to_stream({
            input: anthropicStream,
            completionWriter: this.completionWriter,
            usageWriter: this.usageWriter,
        });
    }
    async cleanup () {
        await Promise.all(this.cleanups);
    }
}

export class AnthropicAPISyncInvocation {
    /**
     * 
     * @param {Object} params
     * @param {import('@anthropic-ai/sdk').Anthropic} params.client
     * @param {import('../common/stream/CompletionWriter').CompletionWriter} params.completionWriter
     */
    constructor ({ client, sdk_params, cleanups }) {
        this.client = client;
        this.sdk_params = sdk_params;
        this.cleanups = cleanups ?? [];
    }
    async run () {
        const msg = await this.client.messages.create(this.sdk_params);
        return {
            message: msg,
            usage: msg.usage,
            finish_reason: 'stop',
        };
    }
    async cleanup () {
        await Promise.all(this.cleanups);
    }
}

export class AnthropicAPIType {
    /**
     * 
     * @param {import('@anthropic-ai/sdk').Anthropic} client
     * @param {import('../common/stream/CompletionWriter').CompletionWriter} completionWriter
     * @param {*} options 
     */
    async stream (client, completionWriter, options) {
        const sdk_params = this.create_sdk_params_(options);
        
        const cleanups = [];
        
        const has_files = await this.handle_files_({ cleanups, messages: options.messages });
        if ( has_files ) {
            client = client.beta;
        }
        
        const usageWriter = options.usageWriter ?? { resolve: () => {} };
        
        return new AnthropicAPIStreamInvocation({
            client,
            sdk_params,
            usageWriter,
            completionWriter,
            cleanups,
        });
    }
    async create (client, options) {
        const sdk_params = this.create_sdk_params_(options);
        
        const cleanups = [];
        
        const has_files = await this.handle_files_({ cleanups, messages: options.messages });
        if ( has_files ) {
            client = client.beta;
        }
        
        return new AnthropicAPISyncInvocation({
            client,
            sdk_params,
            cleanups,
        });
    }
    
    create_sdk_params_ (options) {
        options.tools = AnthropicToolsAdapter.adapt_tools(options.tools);
        
        let system_prompts;
        [system_prompts, options.messages] = NormalizedPromptUtil.extract_and_remove_system_messages(options.messages);
        
        return {
            model: options.model,
            max_tokens: Math.floor(options.max_tokens) ||
                ((
                    model === 'claude-3-5-sonnet-20241022'
                    || model === 'claude-3-5-sonnet-20240620'
                ) ? 8192 : 4096), //required
            temperature: options.temperature || 0, // required
            ...(system_prompts ? {
                system: system_prompts.length > 1
                    ? JSON.stringify(system_prompts)
                    : JSON.stringify(system_prompts[0])
            } : {}),
            messages: options.messages,
            ...(options.tools ? { tools: options.tools } : {}),
        };
    }
    
    async handle_files_ ({ cleanups, messages }) {
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
        
        if ( file_input_tasks.length === 0 ) return false;
        
        const promises = [];
        for ( const task of file_input_tasks ) promises.push((async () => {
            const stream = await task.data.getStream();
            const mimeType = await task.data.getMimeType();

            beta_mode = true;
            const fileUpload = await this.anthropic.beta.files.upload({
                file: await toFile(stream, undefined, { type: mimeType })
            }, {
                betas: [FILES_API_BETA_STRING]
            });
            
            cleanups.push(() => this.anthropic.beta.files.delete(
                fileUpload.id,
                { betas: [FILES_API_BETA_STRING] },
            ));

            // We have to copy a table from the documentation here:
            // https://docs.anthropic.com/en/docs/build-with-claude/files
            const contentBlockTypeForFileBasedOnMime = (() => {
                if ( mimeType.startsWith('image/') ) {
                    return 'image';
                }
                if ( mimeType.startsWith('text/') ) {
                    return 'document';
                }
                if ( mimeType === 'application/pdf' || mimeType === 'application/x-pdf' ) {
                    return 'document';
                }
                return 'container_upload';
            })();
            
            delete task.contentPart.data,
            task.contentPart.type = contentBlockTypeForFileBasedOnMime;
            task.contentPart.source = {
                type: 'file',
                file_id: fileUpload.id,
            };
        })());

        await Promise.all(promises);
        
        return true;
    }
}
