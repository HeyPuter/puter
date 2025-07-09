const { nou } = require('../../../util/langutil');
const Streaming = require('../lib/Streaming');
// const claude_sample = require('../samples/claude-1');
const claude_sample = require('../samples/claude-tools-1');

const echo_stream = {
    write: data => {
        console.log(data);
    }
};

const chatStream = new Streaming.AIChatStream({ stream: echo_stream });

let message;
let contentBlock;
for (const event of claude_sample) {
    if ( event.type === 'message_start' ) {
        message = chatStream.message();
        continue;
    }
    if ( event.type === 'message_stop' ) {
        message.end();
        message = null;
        continue;
    }

    if ( event.type === 'content_block_start' ) {
        if ( event.content_block.type === 'tool_use' ) {
            contentBlock = message.contentBlock({
                type: event.content_block.type,
                id: event.content_block.id,
                name: event.content_block.name,
            });
            continue;
        }
        contentBlock = message.contentBlock({
            type: event.content_block.type,
        });
        continue;
    }

    if ( event.type === 'content_block_stop' ) {
        contentBlock.end();
        contentBlock = null;
        continue;
    }

    if ( event.type === 'content_block_delta' ) {
        if ( event.delta.type === 'input_json_delta' ) {
            contentBlock.addPartialJSON(event.delta.partial_json);
            continue;
        }
        if ( event.delta.type === 'text_delta' ) {
            contentBlock.addText(event.delta.text);
            continue;
        }
    }
}
