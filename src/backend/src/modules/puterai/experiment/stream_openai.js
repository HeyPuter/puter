const { nou } = require('../../../util/langutil');
const FunctionCalling = require('../lib/FunctionCalling');
const Streaming = require('../lib/Streaming');
const openai_fish = require('../samples/openai-tools-1');

const echo_stream = {
    write: data => {
        console.log(data);
    },
};

const chatStream = new Streaming.AIChatStream({
    stream: echo_stream,
});

const message = chatStream.message();
let textblock = message.contentBlock({ type: 'text' });
let toolblock = null;
let mode = 'text';

const tool_call_blocks = [];

for ( const chunk of openai_fish ) {
    if ( chunk.usage ) continue;
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

    if ( ! nou(choice.delta.tool_calls) ) {
        if ( mode === 'text' ) {
            mode = 'tool';
            textblock.end();
        }
        for ( const tool_call of choice.delta.tool_calls ) {
            if ( ! tool_call_blocks[tool_call.index] ) {
                toolblock = message.contentBlock({
                    type: 'tool_use',
                    id: tool_call.function.name,
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
