import { BaseOperation } from '../../../services/OperationTraceService.js';
import { Context } from '../../../util/context.js';
import { simple_retry } from '../../../util/retryutil.js';

class PuterS3UploadStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
        this.s3_resp = null;
        this.uid = null;
    }

    async _run () {
        const { uid, file, storage_meta, storage_api } = this.values;
        this.uid = uid;

        // Deconstruct expected parameters
        // TODO: parametize these to manage errors in backend usage
        const {
            bucket_region,
            bucket,
        } = storage_meta;
        const {
            progress_tracker,
        } = storage_api;

        // Note: while it may seem redundant to deconstruct
        //   these arguments and then pass them to methods,
        //   this is done to assert that the concern of
        //   parameter validation is meant to happen
        //   within this upload() method.

        // Delegate to appropriate upload method
        if ( file.buffer ) {
            return await this._upload_buffer(
                bucket_region,
                bucket,
                uid,
                file,
                progress_tracker,
            );
        }

        return await this._upload_stream(
            bucket_region,
            bucket,
            uid,
            file,
            progress_tracker,
        );
    }
    post_insert ({ db, user, node, uid, message, ts }) {
        (async () => {
            // This case happens in dev environments if a bucket doesn't
            // have versioning enabled.
            if ( ! this.s3_resp?.VersionId ) return;

            db.write(
                'INSERT INTO `fsentry_versions` (`user_id`, `fsentry_id`, `fsentry_uuid`, `version_id`, `message`, `ts_epoch`) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    user.id,
                    node.mysql_id,
                    uid,
                    this.s3_resp.VersionId,
                    message ?? null,
                    ts,
                ],
            );
        })();
    }

    async _upload_buffer (
        bucket_region,
        bucket,
        uid,
        file,
        progress_tracker,
    ) {
        const svc_puterS3 = this.parent.svc_puterS3;
        const [s3_error, s3_eventual_success, s3_resp] = await simple_retry(async () => {
            const ret = await svc_puterS3.upload_buffer({
                bucket_region,
                bucket,
                key: uid,
                buffer: file.buffer,
                // TODO: progress tracker for buffers
            });

            progress_tracker.set_total(file.size);
            progress_tracker.set(file.size);

            return ret;
        }, 3, 200);

        if ( ! s3_eventual_success ) {
            throw s3_error;
        }

        this.s3_resp = s3_resp;
    }

    async _upload_stream (
        bucket_region,
        bucket,
        uid,
        file,
        progress_tracker,
    ) {
        console.log('DOING STREAM UPLOAD');
        const svc_puterS3 = this.parent.svc_puterS3;
        this.checkpoint('before upload stream');
        const [s3_error, s3_eventual_success, s3_resp] = await simple_retry(async () => {
            try {
                // if ( file.size < 5 * 1024 * 1024 ) {
                //     return await svc_puterS3.put_stream({
                //         size: file.size,
                //         bucket_region,
                //         bucket,
                //         key: uid,
                //         stream: file.stream,
                //         on_progress: evt => {
                //             progress_tracker.set_total(file.size);
                //             progress_tracker.set(evt.uploaded);
                //         },
                //     });
                // }

                return await svc_puterS3.upload_stream({
                    bucket_region,
                    bucket,
                    key: uid,
                    stream: file.stream,
                    on_progress: evt => {
                        progress_tracker.set_total(file.size);
                        progress_tracker.set(evt.uploaded);
                    },
                });
            } catch ( e ) {
                console.log('ERRORRRRRR', e);
            }
        }, 3, 200);
        this.checkpoint('after upload stream');

        if ( ! s3_eventual_success ) {
            throw s3_error;
        }

        this.s3_resp = s3_resp;
    }
}

class PuterS3CopyStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
        this.s3_resp = null;
    }

    async _run () {
        const { src_node, dst_storage, storage_api } = this.values;

        const {
            progress_tracker,
        } = storage_api;

        const src_storage = await src_node.get('s3:location');

        const svc_puterS3 = this.parent.svc_puterS3;

        const size = await src_node.get('size');
        if ( size < 4 * 1000 ** 3 - 100 ) {
            const ret = await svc_puterS3.copy_simple({
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

        return await svc_puterS3.copy_multipart({
            src_key: src_storage.key,
            src_bucket: src_storage.bucket,

            dst_key: dst_storage.key,
            dst_bucket_region: dst_storage.bucket_region,
            dst_bucket: dst_storage.bucket,

            size,

            on_progress: evt => {
                const x = Context.get();
                const log = x.get('services').get('log-service').create('PuterS3CopyStrategy');
                log.info('progress', { evt });
                progress_tracker.set_total(size);
                progress_tracker.set(evt.uploaded);
            },
        });
    }

    post_insert ({ db, user, node, uid, message, ts }) {
        (async () => {
            db.write(
                'INSERT INTO `fsentry_versions` (`user_id`, `fsentry_id`, `fsentry_uuid`, `version_id`, `message`, `ts_epoch`) VALUES (?, ?, ?, ?, ?, ?)',
                [
                    user.id,
                    node.mysql_id,
                    uid,
                    this.s3_resp.VersionId,
                    message ?? null,
                    ts,
                ],
            );
        })();
    }
}

class PuterS3DeleteStrategy extends BaseOperation {
    constructor (parent) {
        super();
        this.parent = parent;
    }

    async _run () {
        const { node } = this.values;

        const node_storage = await node.get('s3:location');

        const svc_puterS3 = this.parent.svc_puterS3;

        return await svc_puterS3.delete({
            bucket_region: node_storage.bucket_region,
            bucket: node_storage.bucket,
            key: node_storage.key,
        });
    }
}

export class PuterS3StorageStrategy {
    constructor ({ services }) {
        this.svc_puterS3 = services.get('puter-s3');
    }

    create_upload () {
        const state_upload = new PuterS3UploadStrategy(this);
        return state_upload;
    }

    create_copy () {
        const state_copy = new PuterS3CopyStrategy(this);
        return state_copy;
    }

    create_delete () {
        const state_delete = new PuterS3DeleteStrategy(this);
        return state_delete;
    }

    async create_read_stream (uid, storage_meta) {
        return await this.svc_puterS3.create_read_stream({
            ...storage_meta,
            key: uid,
        });
    }
}
