import fs from 'node:fs';
import path_ from 'node:path';
import { TeePromise } from 'teepromise';

const {
    progress_stream,
    size_limit_stream,
} = extension.import('core').util.streamutil;

export default class LocalDiskStorageController {
    constructor () {
        this.path = path_.join(process.cwd(), '/storage');
    }

    async init () {
        await fs.promises.mkdir(this.path, { recursive: true });
    }

    async upload ({ uid, file, storage_api }) {
        const { progress_tracker } = storage_api;

        if ( file.buffer ) {
            const path = this.#getPath(uid);
            await fs.promises.writeFile(path, file.buffer);

            progress_tracker.set_total(file.buffer.length);
            progress_tracker.set(file.buffer.length);
            return;
        }

        let stream = file.stream;
        stream = progress_stream(stream, {
            total: file.size,
            progress_callback: evt => {
                progress_tracker.set_total(file.size);
                progress_tracker.set(evt.uploaded);
            },
        });
        stream = size_limit_stream(stream, {
            limit: file.size,
        });

        const writePromise = new TeePromise();
        const path = this.#getPath(uid);
        const write_stream = fs.createWriteStream(path);

        write_stream.on('error', () => writePromise.reject());
        write_stream.on('finish', () => writePromise.resolve());

        stream.pipe(write_stream);

        // @ts-ignore (it's wrong about this)
        await writePromise;
    }
    copy () {
    }
    delete () {
    }
    read () {
    }

    #getPath (key) {
        return path_.join(this.path, key);
    }
}