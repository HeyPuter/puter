/**
     * Process input messages from Puter's normalized format to OpenAI's format
     * May make changes in-place.
     *
     * @param {Array<Message>} messages - array of normalized messages
     * @returns {Array<Message>} - array of messages in OpenAI format
     */
const process_input_messages = async (messages) => {
    for ( const msg of messages ) {
        if ( ! msg.content ) continue;
        if ( typeof msg.content !== 'object' ) continue;

        const content = msg.content;

        for ( const o of content ) {
            if ( ! o['image_url'] ) continue;
            if ( o.type ) continue;
            o.type = 'image_url';
        }

        // coerce tool calls
        let is_tool_call = false;
        for ( let i = content.length - 1 ; i >= 0 ; i-- ) {
            const content_block = content[i];

            if ( content_block.type === 'tool_use' ) {
                if ( !msg.tool_calls ) {
                    msg.tool_calls = [];
                    is_tool_call = true;
                }
                msg.tool_calls.push({
                    id: content_block.id,
                    type: 'function',
                    function: {
                        name: content_block.name,
                        arguments: JSON.stringify(content_block.input),
                    },
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
};

const create_usage_calculator = ({ model_details }) => {
    return ({ usage }) => {
        const tokens = [];

        tokens.push({
            type: 'prompt',
            model: model_details.id,
            amount: usage.prompt_tokens,
            cost: model_details.cost.input * usage.prompt_tokens,
        });

        tokens.push({
            type: 'completion',
            model: model_details.id,
            amount: usage.completion_tokens,
            cost: model_details.cost.output * usage.completion_tokens,
        });

        return tokens;
    };
};

const extractMeteredUsage = (usage) => {
    return {
        prompt_tokens: usage.prompt_tokens ?? 0,
        completion_tokens: usage.completion_tokens ?? 0,
        cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
};

const create_chat_stream_handler = ({
    deviations,
    completion,
    usage_calculator,
}) => async ({ chatStream }) => {
    deviations = Object.assign({
        // affected by: Groq
        index_usage_from_stream_chunk: chunk => chunk.usage,
        // affected by: Mistral
        chunk_but_like_actually: chunk => chunk,
        index_tool_calls_from_stream_choice: choice => choice.delta.tool_calls,
    }, deviations);

    const message = chatStream.message();
    let textblock = message.contentBlock({ type: 'text' });
    let toolblock = null;
    let mode = 'text';
    const tool_call_blocks = [];

    let last_usage = null;
    for await ( let chunk of completion ) {
        chunk = deviations.chunk_but_like_actually(chunk);
        if ( process.env.DEBUG ) {
            const delta = chunk?.choices?.[0]?.delta;
            console.log(`AI CHUNK`,
                            chunk,
                            delta && JSON.stringify(delta));
        }
        const chunk_usage = deviations.index_usage_from_stream_chunk(chunk);
        if ( chunk_usage ) last_usage = chunk_usage;
        if ( chunk.choices.length < 1 ) continue;

        const choice = chunk.choices[0];

        if ( choice.delta.reasoning_content ){
            textblock.addReasoning(choice.delta.reasoning_content);
            // Q: Why don't "continue" to next chunk here?
            // A: For now, reasoning_content and content never appear together, but I’m not sure if they’ll always be mutually exclusive.
        }

        if ( choice.delta.content ){
            if ( mode === 'tool' ) {
                toolblock.end();
                mode = 'text';
                textblock = message.contentBlock({ type: 'text' });
            }
            textblock.addText(choice.delta.content);
            continue;
        }

        const tool_calls = deviations.index_tool_calls_from_stream_choice(choice);
        if ( tool_calls ) {
            if ( mode === 'text' ) {
                mode = 'tool';
                textblock.end();
            }
            for ( const tool_call of tool_calls ) {
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

    // TODO DS: this is a bit too abstracted... this is basically just doing the metering now
    usage_calculator({ usage: last_usage });

    if ( mode === 'text' ) textblock.end();
    if ( mode === 'tool' ) toolblock.end();
    message.end();
    chatStream.end();
};

/**
 *
 * @param {object} params
 * @param {(args: {usage: import("openai/resources/completions.mjs").CompletionUsage})=> unknown } params.usage_calculator
 * @returns
 */
const handle_completion_output = async ({
    deviations,
    stream,
    completion,
    moderate,
    usage_calculator,
    finally_fn,
}) => {
    deviations = Object.assign({
        // affected by: Mistral
        coerce_completion_usage: completion => completion.usage,
    }, deviations);

    if ( stream ) {
        const init_chat_stream =
            create_chat_stream_handler({
                deviations,
                completion,
                usage_calculator,
            });

        return {
            stream: true,
            init_chat_stream,
            finally_fn,
        };
    }

    if ( finally_fn ) await finally_fn();

    const is_empty = completion.choices?.[0]?.message?.content?.trim() === '';
    if ( is_empty && ! completion.choices?.[0]?.message?.tool_calls ) {
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
    const completion_usage = deviations.coerce_completion_usage(completion);
    ret.usage = usage_calculator ? usage_calculator({
        ...completion,
        usage: completion_usage,
    }) : {
        input_tokens: completion_usage.prompt_tokens,
        output_tokens: completion_usage.completion_tokens,
    };
    // TODO: turn these into toggle logs
    // console.log('ORIGINAL COMPLETION', completion);
    // console.log('COMPLETION USAGE', completion_usage);
    // console.log('RETURN VALUE', ret);
    return ret;
};

module.exports = {
    process_input_messages,
    create_usage_calculator,
    create_chat_stream_handler,
    handle_completion_output,
    extractMeteredUsage,
};