const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Context } = extension.import('core');
const /**@type {any}*/ svc_fs = extension.import('service:filesystem');
const {
    NodeUIDSelector,
} = extension.import('core').fs.selectors;

const extensionBucketInfo = global_config.services?.thumbnails?.bucket;
const client = extensionBucketInfo?.endpoint && extensionBucketInfo?.credentials ? new S3Client({
    region: 'auto',
    endpoint: extensionBucketInfo.endpoint,
    credentials: extensionBucketInfo.credentials,
}) : extension.import('data').s3ClientProvider.get();
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

const thumbnailBucketName = extensionBucketInfo?.name || 'puter-local';
const extensionBucketEndpoint = extensionBucketInfo?.endpoint || 'http://127.0.0.1:4566/puter-local/';

// A not-user-input-safe base64 data url parser.
function base64ParseDataUrl (dataURL) {
    dataURL = dataURL.slice(5);
    const mimeType = dataURL.split(';')[0];
    const data = Buffer.from(dataURL.split(',')[1], 'base64');
    return { mimeType, data };
}

function estimateDataUrlSize (dataURL) {
    const commaIndex = dataURL.indexOf(',');
    const base64 = commaIndex === -1 ? dataURL : dataURL.slice(commaIndex + 1);
    return Math.ceil(base64.length * 3 / 4);
}

extension.on('thumbnail.created', async (event) => {
    const url = event.url;
    if ( typeof url !== 'string' || !url.startsWith('data:') ) {
        return;
    }
    if ( estimateDataUrlSize(url) > MAX_THUMBNAIL_BYTES ) {
        event.url = null;
        return;
    }

    const key = crypto.randomUUID();

    // Inject in the s3 internal URL in place of the data URL before the operation goes to DB
    event.url = `s3://${thumbnailBucketName}/${key}`;

    // Parse base64 URL created from thumbnail service
    const { mimeType, data } = base64ParseDataUrl(url);

    // Upload thumbnail
    const params = {
        Bucket: thumbnailBucketName,
        Key: key,
        Body: data,
        ContentType: mimeType,
    };
    await client.send(new PutObjectCommand(params));
});

extension.on('thumbnail.upload.prepare', async (event) => {
    if ( !event || !Array.isArray(event.items) ) {
        return;
    }

    for ( const item of event.items ) {
        if ( !item || typeof item !== 'object' ) {
            throw new Error('thumbnail.upload.prepare item is invalid');
        }

        const contentType = typeof item.contentType === 'string'
            ? item.contentType.trim()
            : '';
        if ( ! contentType ) {
            continue;
        }

        if ( item.size !== undefined ) {
            const size = Number(item.size);
            if ( !Number.isFinite(size) || size < 0 ) {
                continue;
            }
            if ( size > MAX_THUMBNAIL_BYTES ) {
                continue;
            }
        }

        const key = crypto.randomUUID();
        const bucket = thumbnailBucketName;
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType,
        });
        const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 });

        item.uploadUrl = uploadUrl;
        item.thumbnailUrl = `s3://${bucket}/${key}`;
    }
});

let in_progress_thumbs = {};

extension.on('thumbnail.read', async (/**@type {any}*/entry) => {
    if ( entry.thumbnail && entry.thumbnail.startsWith('s3://') ) {
        // Parse s3 URL
        const [bucket, key] = entry.thumbnail.slice(5).split('/');

        // Get signed url and inject it into the thumbnail read event
        entry.thumbnail = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if ( entry.thumbnail.startsWith('https') && entry.thumbnail.includes(new URL(extensionBucketEndpoint).hostname) ) {
        // Remove after migration
        let [bucket, key] = new URL(entry.thumbnail).pathname.slice(1).split('/');

        // Get signed url and inject it into the thumbnail read event
        entry.thumbnail = await getSignedUrl(
            client,
            new GetObjectCommand({ Bucket: bucket, Key: key }),
            { expiresIn: 604800 },
        );
    } else if ( entry.thumbnail.startsWith('data') && Context.get('req') && !in_progress_thumbs[entry.uuid] ) {
        in_progress_thumbs[entry.uuid] = true;
        const newNode = await svc_fs.node(new NodeUIDSelector(entry.uuid));
        const key = crypto.randomUUID();
        const { mimeType, data } = base64ParseDataUrl(entry.thumbnail);
        const newUrl = `s3://${thumbnailBucketName}/${key}`;
        // Upload thumbnail
        const params = {
            Bucket: thumbnailBucketName,
            Key: key,
            Body: data,
            ContentType: mimeType,
        };
        (async () => {
            await client.send(new PutObjectCommand(params));
            await newNode.provider.update_thumbnail({
                context: Context.get(),
                node: newNode,
                thumbnail: newUrl,
            });
            delete in_progress_thumbs[entry.uuid];
        })();
    }
});

extension.on('fs.remove.node', async ({ target }) => {
    let thumbnailUrl;
    if ( ! target.thumbnail ) {
        // Stat the entry since we weren't given a thumbnail
        const controls = {
            log: target.log,
            provide_selector: selector => {
                target.selector = selector;
            },
        };
        const newTarget = await target.provider.stat({
            selector: target.selector,
            options: { thumbnail: true },
            node: target,
            controls,
        });

        // There is REALLY just no thumbnail
        if ( ! newTarget.thumbnail )
        {
            return;
        }

        thumbnailUrl = newTarget.thumbnail;
    } else {
        // We were immediately given a thumbnail
        thumbnailUrl = target.thumbnail;
    }

    // Not an S3 thumbnail, likely older format like data URL
    if ( !thumbnailUrl || !thumbnailUrl.startsWith('s3://') )
    {
        return;
    }

    const [bucket, key] = thumbnailUrl.slice(5).split('/');

    // Delete thumbnail from S3
    const params = {
        Bucket: bucket,
        Key: key,
    };
    await client.send(new DeleteObjectCommand(params));
});
