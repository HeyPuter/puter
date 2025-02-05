const putility = require("@heyputer/putility");
const { TypedValue } = require("../../../services/drivers/meta/Runtime");
const { nou } = require("../../../util/langutil");

module.exports = class OpenAIUtil {
    /**
     * Process input messages from Puter's normalized format to OpenAI's format
     * May make changes in-place.
     * 
     * @param {Array<Message>} messages - array of normalized messages
     * @returns {Array<Message>} - array of messages in OpenAI format
     */
    static process_input_messages = async (messages) => {
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
            for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
                const content_block = content[i];

                if ( content_block.type === 'tool_use' ) {
                    if ( ! msg.hasOwnProperty('tool_calls') ) {
                        msg.tool_calls = [];
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
    }

    static create_chat_stream_handler = ({
        completion,
    }) => async ({ chatStream }) => {
        const message = chatStream.message();
        let textblock = message.contentBlock({ type: 'text' });
        let toolblock = null;
        let mode = 'text';
        const tool_call_blocks = [];

        for await ( const chunk of completion ) {
            if ( chunk.usage ) {
                usage_promise.resolve({
                    input_tokens: chunk.usage.prompt_tokens,
                    output_tokens: chunk.usage.completion_tokens,
                });
                continue;
            }
            if ( chunk.choices.length < 1 ) continue;
            
            const choice = chunk.choices[0];

            if ( ! nou(choice.delta.content) ) {
                if ( mode === 'tool' ) {
                    toolblock.end();
                    mode = 'text';
                    textblock = message.contentBlock({ type: 'text' });
                }
                textblock.addText(choice.delta.content);
                continue;
            }

            if (  ! nou(choice.delta.tool_calls) ) {
                if ( mode === 'text' ) {
                    mode = 'tool';
                    textblock.end();
                }
                for ( const tool_call of choice.delta.tool_calls ) {
                    if ( ! tool_call_blocks[tool_call.index] ) {
                        toolblock = message.contentBlock({
                            type: 'tool_use',
                            id: tool_call.id,
                            name: tool_call.function.name,
                        });
                        tool_call_blocks[tool_call.index] = toolblock;
                    } else {
                        toolblock = tool_call_blocks[tool_call.index];
                    }
                    toolblock.addPartialJSON(tool_call.function.arguments);
                }
            }
        }

        if ( mode === 'text' ) textblock.end();
        if ( mode === 'tool' ) toolblock.end();
        message.end();
        chatStream.end();
    };

    static async handle_completion_output ({
        stream, completion, moderate
    }) {
        if ( stream ) {
            let usage_promise = new putility.libs.promise.TeePromise();
        
            const init_chat_stream =
                OpenAIUtil.create_chat_stream_handler({ completion });
            
            return new TypedValue({ $: 'ai-chat-intermediate' }, {
                stream: true,
                init_chat_stream,
                usage_promise: usage_promise,
            });
        }

        const is_empty = completion.choices?.[0]?.message?.content?.trim() === '';
        if ( is_empty ) {
            // GPT refuses to generate an empty response if you ask it to,
            // so this will probably only happen on an error condition.
            throw new Error('an empty response was generated');
        }

        // We need to moderate the completion too
        const mod_text = completion.choices[0].message.content;
        if ( moderate && mod_text !== null ) {
            const moderation_result = await moderate(mod_text);
            if ( moderation_result.flagged ) {
                throw new Error('message is not allowed');
            }
        }
        
        const ret = completion.choices[0];
        ret.usage = {
            input_tokens: completion.usage.prompt_tokens,
            output_tokens: completion.usage.completion_tokens,
        };
        return ret;
    }
};