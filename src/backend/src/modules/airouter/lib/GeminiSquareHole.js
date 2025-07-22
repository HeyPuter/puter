/**
 * Technically this should be called "GeminiUtil",
 * but Google's AI API defies all the established conventions
 * so it made sense to defy them here as well.
 */

module.exports = class GeminiSquareHole {
    static process_input_messages = async (messages) => {
        messages = messages.slice();

        for ( const msg of messages ) {
            msg.parts = msg.content;
            delete msg.content;

            if ( msg.role === 'assistant' ) {
                msg.role = 'model';
            }

            for ( let i=0 ; i < msg.parts.length ; i++ ) {
                const part = msg.parts[i];
                if ( part.type === 'tool_use' ) {
                    msg.parts[i] = {
                        functionCall: {
                            name: part.id,
                            args: part.input,
                        },
                    };
                }
                if ( part.type === 'tool_result' ) {
                    msg.parts[i] = {
                        functionResponse: {
                            name: part.tool_use_id,
                            response: {
                                name: part.tool_use_id,
                                content: part.content,
                            },
                        },
                    };
                }
                if ( part.type === 'text' ) {
                    msg.parts[i] = {
                        text: part.text,
                    };
                }
            }
        }

        return messages;
    }

    static create_usage_calculator = ({ model_details }) => {
        return ({ usageMetadata }) => {
            const tokens = [];
            
            tokens.push({
                type: 'prompt',
                model: model_details.id,
                amount: usageMetadata.promptTokenCount,
                cost: model_details.cost.input * usageMetadata.promptTokenCount,
            });

            tokens.push({
                type: 'completion',
                model: model_details.id,
                amount: usageMetadata.candidatesTokenCount,
                cost: model_details.cost.output * usageMetadata.candidatesTokenCount,
            });

            return tokens;
        };
    };

    static create_chat_stream_handler = ({
        stream, // GenerateContentStreamResult:stream
        usage_promise,
    }) => async ({ chatStream }) => {
        const message = chatStream.message();
        
        let textblock = message.contentBlock({ type: 'text' });
        let toolblock = null;
        let mode = 'text';

        
        let last_usage = null;
        for await ( const chunk of stream ) {
            // This is spread across several lines so that the stack trace
            // is more helpful if we get an exception because of an
            // inconsistent response from the model.
            const candidate = chunk.candidates[0];
            const content = candidate.content;
            const parts = content.parts;
            for ( const part of parts ) {
                if ( part.functionCall ) {
                    if ( mode === 'text' ) {
                        mode = 'tool';
                        textblock.end();
                    }

                    toolblock = message.contentBlock({
                        type: 'tool_use',
                        id: part.functionCall.name,
                        name: part.functionCall.name,
                    });
                    toolblock.addPartialJSON(JSON.stringify(
                        part.functionCall.args,
                    ));

                    continue;
                }

                if ( mode === 'tool' ) {
                    mode = 'text';
                    toolblock.end();
                    textblock = message.contentBlock({ type: 'text' });
                }

                // assume text as default
                const text = part.text;
                textblock.addText(text);
            }

            last_usage = chunk.usageMetadata;
        }

        usage_promise.resolve(last_usage);

        if ( mode === 'text' ) textblock.end();
        if ( mode === 'tool' ) toolblock.end();
        message.end();
        chatStream.end();
    }
}
