module.exports = [
    {
        type: 'message_start',
        message: {
            id: 'msg_01GAy4THpFyFJcpxqWXBMrvx',
            type: 'message',
            role: 'assistant',
            model: 'claude-3-5-sonnet-20241022',
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
                input_tokens: 458,
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
        delta: { type: 'text_delta', text: 'I' }
    },
    {
        type: 'content_block_delta',
        index: 0,
        delta: {
            type: 'text_delta',
            text: "'ll check the weather in Vancouver for you."
        }
    },
    { type: 'content_block_stop', index: 0 },
    {
        type: 'content_block_start',
        index: 1,
        content_block: {
            type: 'tool_use',
            id: 'toolu_01E12jeyCenTtntPBk1j7rgc',
            name: 'get_weather',
            input: {}
        }
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '' }
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"location"' }
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: ': "Van' }
    },
    {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: 'couver"}' }
    },
    { type: 'content_block_stop', index: 1 },
    {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 64 }
    },
    { type: 'message_stop' },
]
