import { toFile } from "@anthropic-ai/sdk";
import { betas } from "./consts.js";

export default async ({ client, cleanups, messages }) => {
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
    
    if ( file_input_tasks.length === 0 ) return false;
    
    const promises = [];
    for ( const task of file_input_tasks ) promises.push((async () => {
        const stream = await task.data.getStream();
        const mimeType = await task.data.getMimeType();

        const fileUpload = await client.files.upload({
            file: await toFile(stream, undefined, { type: mimeType })
        }, { betas });
        
        cleanups.push(() => client.files.delete( fileUpload.id, { betas }));

        // We have to copy a table from the documentation here:
        // https://docs.anthropic.com/en/docs/build-with-claude/files
        const contentBlockTypeForFileBasedOnMime = (() => {
            if ( mimeType.startsWith('image/') ) {
                return 'image';
            }
            if ( mimeType.startsWith('text/') ) {
                return 'document';
            }
            if ( mimeType === 'application/pdf' || mimeType === 'application/x-pdf' ) {
                return 'document';
            }
            return 'container_upload';
        })();
        
        delete task.contentPart.data,
        task.contentPart.type = contentBlockTypeForFileBasedOnMime;
        task.contentPart.source = {
            type: 'file',
            file_id: fileUpload.id,
        };
    })());

    await Promise.all(promises);
    
    return true;
}