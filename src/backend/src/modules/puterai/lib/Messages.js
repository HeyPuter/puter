const { whatis } = require("../../../util/langutil");

module.exports = class Messages {
    static normalize_single_message (message, params = {}) {
        params = Object.assign({
            role: 'user',
        }, params);

        if ( typeof message === 'string' ) {
            message = {
                content: [message],
            };
        }
        if ( whatis(message) !== 'object' ) {
            throw new Error('each message must be a string or object');
        }
        if ( ! message.role ) {
            message.role = params.role;
        }
        if ( ! message.content ) {
            throw new Error(`each message must have a 'content' property`);
        }
        if ( whatis(message.content) !== 'array' ) {
            message.content = [message.content];
        }
        for ( let i=0 ; i < message.content.length ; i++ ) {
            if ( whatis(message.content[i]) === 'string' ) {
                message.content[i] = {
                    type: 'text',
                    text: message.content[i],
                };
            }
            if ( whatis(message.content[i]) !== 'object' ) {
                throw new Error('each message content item must be a string or object');
            }
            if ( ! message.content[i].type ) {
                message.content[i].type = 'text';
            }
        }

        console.log('???', message)
        return message;
    }
    static normalize_messages (messages, params = {}) {
        for ( let i=0 ; i < messages.length ; i++ ) {
            messages[i] = this.normalize_single_message(messages[i], params);
        }
    }
}