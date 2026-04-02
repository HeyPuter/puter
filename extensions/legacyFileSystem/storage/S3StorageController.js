import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand, CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, UploadPartCommand, UploadPartCopyCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { TeePromise } from 'teepromise';

const { s3ClientProvider } = extension.import('data');

const { Context } = extension.import('core');

const {
    chunk_stream,
} = extension.import('core').util.streamutil;

const {
    simple_retry,
} = extension.import('core').util.retryutil;

const {
    EWMA,
} = extension.import('core').util.opmath;

export default class S3StorageController {
    forceDefault = true;
    async init () {
        this.clients_ = {};
        this.config = global_config;

        this.global_average_S3_part_time = new EWMA({
            initial: 4000, // average from local testing
            alpha: 0.1,
        });
    }

    #get_client (region) {

        return s3ClientProvider(region);
    }

    async upload ({ uid, file, storage_meta, storage_api }) {
        const { progress_tracker } = storage_api;

        const {
            bucket_region,
            bucket,
        } = storage_meta;

        const client = this.#get_client(bucket_region);

        if ( file.buffer ) {
            const [s3_error, s3_eventual_success, _s3_resp] = await simple_retry(async () => {
                const ret = await client.send(new PutObjectCommand({
                    Bucket: bucket,
                    Key: uid,
                    Body: file.buffer,
                }));
                progress_tracker.set_total(file.size);
                progress_tracker.set(file.size);
                return ret;
            }, 3, 200);

            if ( ! s3_eventual_success ) {
                throw s3_error;
            }

            return; // AKA "} else {{"
        }

        const [s3_error, s3_eventual_success, _s3_resp] = await simple_retry(async () => {
            return await this.#upload_stream({
                bucket_region,
                bucket,
                key: uid,
                stream: file.stream,
                on_progress: evt => {
                    progress_tracker.set_total(file.size);
                    progress_tracker.set(evt.uploaded);
                },
            });
        }, 3, 200);

        if ( ! s3_eventual_success ) {
            throw s3_error;
        }
    }

    async copy ({ src_node, dst_storage, storage_api }) {
        const {
            progress_tracker,
        } = storage_api;

        const src_storage = await src_node.get('s3:location');

        const size = await src_node.get('size');
        if ( size < 4 * 1000 ** 3 - 100 ) {
            const ret = await this.#copy_simple({
                src_key: src_storage.key,
                src_bucket: src_storage.bucket,

                dst_key: dst_storage.key,
                dst_bucket_region: dst_storage.bucket_region,
                dst_bucket: dst_storage.bucket,
            });
            progress_tracker.set_total(size);
            progress_tracker.set(size);
            return ret;
        }

        return await this.#copy_multipart({
            src_key: src_storage.key,
            src_bucket: src_storage.bucket,

            dst_key: dst_storage.key,
            dst_bucket_region: dst_storage.bucket_region,
            dst_bucket: dst_storage.bucket,

            size,

            on_progress: evt => {
                const x = Context.get();
                progress_tracker.set_total(size);
                progress_tracker.set(evt.uploaded);
            },
        });
    }
    async delete ({ node }) {
        const node_storage = await node.get('s3:location');

        const client = this.#get_client(node_storage.bucket_region);

        return await client.send(new DeleteObjectCommand({
            Bucket: node_storage.bucket,
            Key: node_storage.key,
        }));
    }
    async read ({ location, range, version_id }) {
        const { bucket_region, bucket, key } = location;
        const client = this.#get_client(bucket_region);

        const response = await client.send(new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(range ? { Range: range } : {}),
            ...(version_id ? { VersionId: version_id } : {}),
        }));

        const stream = Readable.from(response.Body);

        return stream;
    }

    async #upload_stream ({ bucket_region, bucket, key, stream, on_progress }) {
        const client = this.#get_client(bucket_region);

        const multipart_upload = await client.send(new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
        }));

        let ret; // return value

        try {
            const part_size = 1024 * 1024 * 5; // 5MB
            //

            // get each part while streaming
            const chunk_iterator = chunk_stream(
                stream,
                part_size,
                this.global_average_S3_part_time,
            );
            let i = 0;
            let uploaded_bytes = 0;
            let upload_promises = [];
            const upload_results = [];

            let tp;
            let count_parts_being_uploaded = 0;

            let check_queue;

            let queue_empty_promise = null;

            const upload_part = async part => {

                if ( count_parts_being_uploaded >= 4 ) {
                    console.log('too many concurrent part uploads; halting');
                    tp = new TeePromise();
                    await tp;
                }

                const part_number = ++i;

                count_parts_being_uploaded++;

                const upload_promise = (async () => {

                    const ts_start = Date.now();

                    const [err, success, result] = await simple_retry(async () => {
                        return await client.send(new UploadPartCommand({
                            Bucket: bucket,
                            Key: key,
                            PartNumber: part_number,
                            UploadId: multipart_upload.UploadId,
                            Body: part,
                        }));
                    }, 3, 50);

                    if ( err || !success ) {
                        throw err;
                    }

                    const ts_end = Date.now();
                    const elapsed = ts_end - ts_start;
                    const elapsed_per_part_size = elapsed * (part.length / part_size);
                    // this.global_average_S3_part_time.put(elapsed);
                    this.global_average_S3_part_time.put(elapsed_per_part_size);

                    uploaded_bytes += part.length;
                    on_progress({ uploaded: uploaded_bytes });

                    count_parts_being_uploaded--;
                    if ( tp ) {
                        const p = tp;
                        tp = null;
                        p.resolve();
                    }

                    check_queue();

                    return result;
                })();

                upload_promises.push(upload_promise);
            };

            check_queue = () => {
                if ( part_queue.length > 0 ) {
                    const part = part_queue.shift();
                    upload_part(part);
                    if ( part_queue.length == 0 ) {
                        if ( queue_empty_promise ) {
                            const p = queue_empty_promise;
                            queue_empty_promise = null;
                            p.resolve();
                        }
                    }
                }
            };

            const part_queue = [];

            for await ( const chunk of chunk_iterator ) {
                await upload_part(chunk);
            }

            // If the file is empty we still need to upload a part
            if ( i === 0 ) {
                const upload_promise = (async () => {
                    const [err, success, result] = await simple_retry(async () => {
                        return await client.send(new UploadPartCommand({
                            Bucket: bucket,
                            Key: key,
                            PartNumber: 1,
                            UploadId: multipart_upload.UploadId,
                            Body: Buffer.alloc(0),
                        }));
                    }, 3, 50);

                    if ( err || !success ) {
                        throw err;
                    }

                    on_progress({ uploaded: uploaded_bytes });
                    return result;
                })();

                upload_promises.push(upload_promise);
            }

            if ( part_queue.length > 0 ) {
                queue_empty_promise = new TeePromise();
                await queue_empty_promise;
            }

            const some_results = await Promise.all(upload_promises);
            upload_results.push(...some_results);

            try {
                // complete the upload
                ret = await client.send(new CompleteMultipartUploadCommand({
                    Bucket: bucket,
                    Key: key,
                    UploadId: multipart_upload.UploadId,
                    MultipartUpload: {
                        Parts: upload_results.map((_, i) => ({
                            PartNumber: i + 1,
                            ETag: _.ETag,
                        })),
                    },
                }));
            } catch ( e ) {
                console.warn(`catch block: ${e.message}`);
            }
        } catch ( e ) {
            console.error(`error: ${e.message}`);
            // abort the upload
            await client.send(new AbortMultipartUploadCommand({
                Bucket: bucket,
                Key: key,
                UploadId: multipart_upload.UploadId,
            }));

            throw e;
        }

        return ret;
    }
    async #copy_simple ({
        dst_bucket_region,
        dst_bucket,
        src_bucket,
        src_key,
        dst_key,
    }) {
        const client = this.#get_client(dst_bucket_region);

        const ret = await client.send(new CopyObjectCommand({
            Bucket: dst_bucket,
            Key: dst_key,
            CopySource: `${src_bucket}/${src_key}`,
        }));

        return ret;
    }

    async #copy_multipart ({
        dst_bucket_region,
        dst_bucket,
        src_bucket,
        src_key,
        dst_key,
        on_progress,
        size,
    }) {
        const client = this.#get_client(dst_bucket_region);

        const multipart_upload = await client.send(new CreateMultipartUploadCommand({
            Bucket: dst_bucket,
            Key: dst_key,
        }));

        const part_size = 4 * 1024 * 1024 * 1024; // 1GiB

        const results = [];

        let part_number_i = 0;
        for ( let byte_start = 0 ; byte_start < size ; byte_start += part_size ) {
            const part_number = ++part_number_i;
            // byte range is inclusive... WTF?
            const byte_end = Math.min(byte_start + part_size, size) - 1;

            const [err, success, result] = await simple_retry(async () => {
                const params = {
                    Bucket: dst_bucket,
                    Key: dst_key,
                    PartNumber: part_number,
                    UploadId: multipart_upload.UploadId,
                    CopySource: `${src_bucket}/${src_key}`,
                    CopySourceRange: `bytes=${byte_start}-${byte_end}`,
                };
                return await client.send(new UploadPartCopyCommand(params));
            }, 3, 50);

            if ( err || !success ) {
                throw err;
            }

            results.push(result);

            on_progress({ uploaded: byte_end + 1 });
        }

        const ret = await client.send(new CompleteMultipartUploadCommand({
            Bucket: dst_bucket,
            Key: dst_key,
            UploadId: multipart_upload.UploadId,
            MultipartUpload: {
                Parts: results.map((_, i) => ({
                    PartNumber: i + 1,
                    ETag: _.CopyPartResult.ETag,
                })),
            },
        }));

        return ret;
    }
}
