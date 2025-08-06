import { stream_to_buffer } from "../common/util/streamutil.js";

const MAX_FILE_SIZE = 5 * 1_000_000;

export default async ({ messages }) => {
    const file_input_tasks = [];
    for ( const message of messages ) {
        // We can assume `message.content` is not undefined because
        // UniversalPromptNormalizer ensures this.
        for ( const contentPart of message.content ) {
            if ( contentPart.type !== 'data' ) continue;
            const { data } = contentPart;
            delete contentPart.data;
            file_input_tasks.push({
                data,
                contentPart,
            });
        }
    }
    
    const promises = [];
    for ( const task of file_input_tasks ) promises.push((async () => {
        if ( await task.data.getSize() > MAX_FILE_SIZE ) {
            delete task.contentPart.puter_path;
            task.contentPart.type = 'text';
            task.contentPart.text = `{error: input file exceeded maximum of ${MAX_FILE_SIZE} bytes; ` +
                `the user did not write this message}`; // "poor man's system prompt"
            return; // "continue"
        }
        
        const stream = await task.data.getStream();
        const mimeType = await task.data.getMimeType();
        
        const buffer = await stream_to_buffer(stream);
        const base64 = buffer.toString('base64');
        
        delete task.contentPart.puter_path;
        if ( mimeType.startsWith('image/') ) {
            task.contentPart.type = 'image_url',
            task.contentPart.image_url = {
                url: `data:${mimeType};base64,${base64}`,
            };
        } else if ( mimeType.startsWith('audio/') ) {
            task.contentPart.type = 'input_audio',
            task.contentPart.input_audio = {
                data: `data:${mimeType};base64,${base64}`,
                format: mimeType.split('/')[1],
            }
        } else {
            task.contentPart.type = 'text';
            task.contentPart.text = `{error: input file has unsupported MIME type; ` +
                `the user did not write this message}`; // "poor man's system prompt"
        }
    })());
    await Promise.all(promises);
}
