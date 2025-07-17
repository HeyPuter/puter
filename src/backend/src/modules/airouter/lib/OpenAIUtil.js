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
        const { OpenAIStyleMessagesAdapter } = await import("@heyputer/airouter.js");
        return (new OpenAIStyleMessagesAdapter()).adapt_messages(messages);
    }

    static create_usage_calculator = ({ model_details }) => {
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

    static create_chat_stream_handler = ({
        deviations,
        completion, usage_promise,
    }) => async ({ chatStream }) => {
        const { OpenAIStyleStreamAdapter } = await import("@heyputer/airouter.js");
        const StreamAdapter = class extends OpenAIStyleStreamAdapter {};
        for ( const key in deviations ) {
            StreamAdapter[key] = deviations[key];
        }
        
        await StreamAdapter.write_to_stream({
            input: completion,
            completionWriter: chatStream,
            usageWriter: usage_promise,
        });
    };

    static async handle_completion_output ({
        deviations,
        stream, completion, moderate,
        usage_calculator,
        finally_fn,
    }) {
        deviations = Object.assign({
            // affected by: Mistral
            coerce_completion_usage: completion => completion.usage,
        }, deviations);

        if ( stream ) {
            let usage_promise = new putility.libs.promise.TeePromise();
        
            const init_chat_stream =
                OpenAIUtil.create_chat_stream_handler({
                    deviations,
                    completion,
                    usage_promise,
                    usage_calculator,
                });
            
            return new TypedValue({ $: 'ai-chat-intermediate' }, {
                stream: true,
                init_chat_stream,
                finally_fn,
                usage_promise: usage_promise.then(usage => {
                    return usage_calculator ? usage_calculator({ usage }) : {
                        input_tokens: usage.prompt_tokens,
                        output_tokens: usage.completion_tokens,
                    };
                }),
            });
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
    }
};