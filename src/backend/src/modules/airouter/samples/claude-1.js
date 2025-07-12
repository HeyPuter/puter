module.exports = [
    {
        type: 'message_start',
        message: {
            id: 'msg_01KKQeaUDpMzNovH9utP5qJc',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-5-sonnet-20241022',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: 82,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 1
            }
        }
    },
    {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Some' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' species of fish, like the electric' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: {
            type: 'text_delta',
            text: ' eel, can generate powerful electrical'
        }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' charges of up to 860 ' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'volts to stun prey an' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'd defend themselves.' }
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 35 }
    },
    { type: 'message_stop' },
]