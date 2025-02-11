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
        }

        return messages;
    }
}
