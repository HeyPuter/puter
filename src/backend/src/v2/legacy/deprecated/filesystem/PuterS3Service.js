import { AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CopyObjectCommand, CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, UploadPartCommand, UploadPartCopyCommand } from '@aws-sdk/client-s3';
import BaseService from '../../services/BaseService.js';
import { Context } from '../../util/context.js';
import { TeePromise } from '@heyputer/putility/src/libs/promise.js';
import { Readable } from 'stream';
import { s3ClientProvider } from '../../clients/s3/s3ClientProvider.js';
import { EWMA } from '../../util/opmath.js';
import { simple_retry } from '../../util/retryutil.js';
import { chunk_stream, progress_stream } from '../../util/streamutil.js';
import { PuterS3StorageStrategy } from '../filesystem/strategies/PuterS3StorageStrategy.js';

export class PuterS3Service extends BaseService {

    async _init () {
        this.clients_ = {};
        this.config = this.global_config;

        this.global_average_S3_part_time = new EWMA({
            initial: 4000, // average from local testing
            alpha: 0.1,
        });
    }

    async '__on_install.context-initializers' () {
    // async _init () {
        const svc_contextInit = this.services.get('context-init');
        const storage = new PuterS3StorageStrategy({ services: this.services });
        svc_contextInit.register_value('storage', storage);

        const svc_mountpoint = this.services.get('mountpoint');
        svc_mountpoint.set_storage('PuterFSProvider', storage);

        // This alternative approach can be used if the arguments to
        // the storage strategy become context-sensitive:
        // svc_contextInit.register_async_factory('storage', async () => {
        //     return new PuterS3StorageStrategy({ services: this.services });
        // });
    }

    _get_client (region) {
        return s3ClientProvider.get(region);
    }

    async create_read_stream ({ bucket_region, bucket, key, version_id, range }) {
        const client = this._get_client(bucket_region);

        let response;
        try {
            response = await client.send(new GetObjectCommand({
                Bucket: bucket,
                Key: key,
                ...(range ? { Range: range } : {}),
                ...(version_id ? { VersionId: version_id } : {}),
            }));
        } catch ( e ) {
            this.errors.report('s3:read', {
                source: e,
                message: 'Error reading from S3',
                trace: true,
                alarm: true,
                extra: {
                    bucket_region,
                    bucket,
                    key,
                    version_id,
                    range,
                },
            });

            throw e;
        }

        const stream = Readable.from(response.Body);

        return stream;
    }

    async upload_buffer ({ bucket_region, bucket, key, buffer }) {
        const client = this._get_client(bucket_region);

        let ret;

        try {
            ret = await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: buffer,
            }));
        } catch ( e ) {
            this.errors.report('s3:upload', {
                source: e,
                message: 'Error uploading to S3',
                trace: true,
                alarm: true,
                extra: {
                    bucket,
                    key,
                },
            });

            throw e;
        }

        return ret;
    }

    async put_stream ({ size, bucket_region, bucket, key, stream, on_progress }) {
        const verb_log = (() => {
            const context = Context.get();
            const svc = context.get('services');
            const svc_operationTrace = svc.get('operationTrace');
            const svc_log = svc.get('log-service');
            const frame = context.get(svc_operationTrace.ckey('frame'));
            const frame_id = frame.id;
            const log = svc_log.create('s3-upload', {
                operation: frame_id,
            });
            return log.info.bind(log);
        })();
        verb_log('put_stream', { bucket_region, bucket, key });

        const client = this._get_client(bucket_region);

        let ret;

        // Intercept body stream for progress tracking
        const body_stream = progress_stream(stream, {
            total: size,
            progress_callback: on_progress,
        });

        try {
            ret = await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: body_stream,
                ContentLength: size,
            }));
        } catch ( e ) {
            this.errors.report('s3:upload', {
                source: e,
                message: 'Error uploading to S3',
                trace: true,
                alarm: true,
                extra: {
                    bucket,
                    key,
                },
            });

            throw e;
        }

        return ret;
    }

    async upload_stream ({ bucket_region, bucket, key, stream, on_progress }) {
        const client = this._get_client(bucket_region);

        console.debug('upload_stream', { bucket_region, bucket, key });

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
                    console.warn('too many concurrent part uploads; halting');
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
                        this.errors.report('s3:upload', {
                            source: err || new Error('unknown'),
                            message: 'Error uploading to S3',
                            trace: true,
                            alarm: true,
                            extra: {
                                bucket,
                                key,
                                part_number,
                            },
                        });
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

            const part_queue = [];

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
                        this.errors.report('s3:upload', {
                            source: err || new Error('unknown'),
                            message: 'Error uploading to S3',
                            trace: true,
                            alarm: true,
                            extra: {
                                bucket,
                                key,
                                part_number: 1,
                            },
                        });
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
            } finally {
                // no-op
            }
        } catch ( e ) {
            console.error(`error: ${e.message}`);
            // abort the upload
            try {
                await client.send(new AbortMultipartUploadCommand({
                    Bucket: bucket,
                    Key: key,
                    UploadId: multipart_upload.UploadId,
                }));
            } catch ( e2 ) {
                this.errors.report('s3:upload.abort', {
                    source: e2,
                    message: 'Error aborting multipart upload',
                    trace: true,
                    alarm: true,
                    extra: {
                        bucket,
                        key,
                    },
                });
            }

            this.errors.report('s3:upload', {
                source: e,
                message: 'Error uploading to S3',
                trace: true,
                alarm: true,
                extra: {
                    bucket,
                    key,
                },
            });

            throw e;
        }

        return ret;
    }

    async copy_simple ({
        dst_bucket_region,
        dst_bucket,
        src_bucket,
        src_key,
        dst_key,
    }) {
        const client = this._get_client(dst_bucket_region);

        let ret;

        // const copy_source_urlencoded = encodeURIComponent(src_bucket + '/' + src_key);

        try {
            ret = await client.send(new CopyObjectCommand({
                Bucket: dst_bucket,
                Key: dst_key,
                CopySource: `${src_bucket}/${src_key}`,
            }));
        } catch ( e ) {
            this.errors.report('s3:copy', {
                source: e,
                message: 'Error copying to S3',
                trace: true,
                alarm: true,
                extra: {
                    src_bucket,
                    src_key,
                    dst_bucket,
                    dst_key,
                },
            });

            throw e;
        }

        return ret;
    }

    async copy_multipart ({
        dst_bucket_region,
        dst_bucket,
        src_bucket,
        src_key,
        dst_key,
        on_progress,
        size,
    }) {
        const client = this._get_client(dst_bucket_region);

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
                this.errors.report('s3:copy', {
                    source: err || new Error('unknown'),
                    message: 'Error copying to S3',
                    trace: true,
                    alarm: true,
                    extra: {
                        src_bucket,
                        src_key,
                        dst_bucket,
                        dst_key,
                        part_number,
                    },
                });
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

    async delete ({ bucket_region, bucket, key }) {
        const client = this._get_client(bucket_region);

        return await client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
        }));
    }

}
