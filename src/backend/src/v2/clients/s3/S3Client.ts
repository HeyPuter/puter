import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    PutObjectCommand,
    S3Client as AwsS3Client,
    type S3ClientConfig,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import type { FauxqsServer } from 'fauxqs';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { Agent as HttpsAgent } from 'node:https';
import path from 'node:path';
import type { IConfig } from '../../types';
import { PuterClient } from '../types';

const DEFAULT_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;
const FAUXQS_SAFE_PUT_OBJECT_LIMIT_BYTES = 10 * 1024 * 1024;
const LEGACY_STORAGE_BUCKET = 'puter-local';

type S3CommandSender = Pick<AwsS3Client, 'send'>;

export class S3Client extends PuterClient {

    private clientMap = new Map<string, AwsS3Client>();
    private awsConfig: Partial<S3ClientConfig> = {};
    private fauxqsServer: FauxqsServer | null = null;
    private useProviderChain = false;

    /** Maximum size for a single PutObject call before switching to multipart. */
    maxSingleUploadSize = FAUXQS_SAFE_PUT_OBJECT_LIMIT_BYTES;
    /** Part size used for multipart uploads. */
    partSize = DEFAULT_MULTIPART_PART_SIZE_BYTES;

    constructor (config: IConfig) {
        super(config);
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    override async onServerStart (): Promise<void> {
        const s3Conf = this.config.s3;

        if ( s3Conf && 's3Config' in s3Conf && s3Conf.s3Config ) {
            // Real S3 / S3-compatible endpoint
            const { endpoint, accessKeyId, secretAccessKey, region, useCredentialChain } = s3Conf.s3Config;

            if ( useCredentialChain ) {
                this.useProviderChain = true;
                this.awsConfig = { credentials: fromNodeProviderChain() };
                this.partSize = 64 * 1024 * 1024;
                this.maxSingleUploadSize = 128 * 1024 * 1024;
            } else {
                this.awsConfig = {
                    endpoint,
                    credentials: { accessKeyId, secretAccessKey },
                    ...(region ? { region } : {}),
                };
            }

            console.log('[s3] configured with remote endpoint');
        } else {
            // Local dev: spin up fauxqs in-process
            const forceInMem = s3Conf && 'localConfig' in s3Conf && s3Conf.localConfig?.inMemory;
            const fauxqsHost = forceInMem ? '127.0.0.1' : s3Conf?.localConfig?.host;

            const { startFauxqs } = await import('fauxqs');
            this.fauxqsServer = await startFauxqs({
                host: fauxqsHost,
                port: forceInMem ? 0 : 4566,
                logger: false,
                dataDir:      forceInMem ? undefined : './fauxqs-data',
                s3StorageDir: forceInMem ? undefined : './fauxqs-s3-data',
                init: { region: 'us-west-2', buckets: [LEGACY_STORAGE_BUCKET] },
            });

            this.awsConfig = {
                endpoint: this.fauxqsServer.address,
                credentials: { accessKeyId: 'fakeAccessKeyId', secretAccessKey: 'fakeSecretAccessKey' },
            };

            console.log(`[s3] started local fauxqs at ${this.fauxqsServer.address}`);

            // Migrate files from legacy local storage directory if present
            if ( !forceInMem ) {
                const result = await this.migrateLegacyStorage();
                if ( result.migratedFileCount > 0 ) {
                    console.log(`[s3] migrated ${result.migratedFileCount} file(s) from legacy storage`);
                }
            }
        }
    }

    override async onServerShutdown (): Promise<void> {
        if ( this.fauxqsServer ) {
            await this.fauxqsServer.stop();
            this.fauxqsServer = null;
        }
        for ( const client of this.clientMap.values() ) {
            client.destroy();
        }
        this.clientMap.clear();
    }

    // ------------------------------------------------------------------
    // Public API
    // ------------------------------------------------------------------

    /**
     * Get (or create) an S3Client for the given region.
     * Clients are cached per-region for connection reuse.
     */
    get (region = 'us-west-2'): AwsS3Client {
        const existing = this.clientMap.get(region);
        if ( existing ) return existing;

        const client = new AwsS3Client({
            region,
            requestStreamBufferSize: 32 * 1024,
            requestHandler: new NodeHttpHandler({
                socketTimeout: 5000,
                httpsAgent: new HttpsAgent({
                    maxSockets: 500,
                    keepAlive: true,
                    keepAliveMsecs: 1000,
                }),
            }),
            ...this.awsConfig,
        });

        this.clientMap.set(region, client);
        return client;
    }

    // ------------------------------------------------------------------
    // Legacy storage migration
    // ------------------------------------------------------------------

    private async migrateLegacyStorage (opts: {
        bucket?: string;
        legacyPath?: string;
    } = {}): Promise<{ migratedFileCount: number; scannedEntryCount: number }> {
        const bucket = opts.bucket ?? LEGACY_STORAGE_BUCKET;
        const legacyPath = opts.legacyPath ?? path.join(process.cwd(), 'storage');

        if ( !existsSync(legacyPath) ) {
            return { migratedFileCount: 0, scannedEntryCount: 0 };
        }

        const client = this.get();
        const entries = await fs.readdir(legacyPath);
        let migratedFileCount = 0;

        for ( const entryName of entries ) {
            const filePath = path.join(legacyPath, entryName);
            const stat = await fs.stat(filePath);
            if ( !stat.isFile() ) continue;

            if ( stat.size > this.maxSingleUploadSize ) {
                await this.uploadMultipart({ bucket, client, filePath, fileSize: stat.size, key: entryName });
            } else {
                const body = await fs.readFile(filePath);
                await client.send(new PutObjectCommand({ Bucket: bucket, Key: entryName, Body: body }));
            }
            migratedFileCount++;
        }

        await fs.rm(legacyPath, { recursive: true });
        return { migratedFileCount, scannedEntryCount: entries.length };
    }

    private async uploadMultipart ({ bucket, client, filePath, fileSize, key }: {
        bucket: string;
        client: S3CommandSender;
        filePath: string;
        fileSize: number;
        key: string;
    }): Promise<void> {
        const { UploadId } = await client.send(
            new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }),
        );
        if ( !UploadId ) throw new Error(`Failed to start multipart upload for ${filePath}`);

        const uploadedParts: { ETag: string; PartNumber: number }[] = [];
        const fileHandle = await fs.open(filePath, 'r');

        try {
            let offset = 0;
            let partNumber = 1;

            while ( offset < fileSize ) {
                const partLength = Math.min(this.partSize, fileSize - offset);
                const partBuffer = Buffer.alloc(partLength);
                const { bytesRead } = await fileHandle.read(partBuffer, 0, partLength, offset);
                if ( bytesRead <= 0 ) break;

                const body = bytesRead === partBuffer.length ? partBuffer : partBuffer.subarray(0, bytesRead);
                const { ETag } = await client.send(new UploadPartCommand({
                    Bucket: bucket, ContentLength: bytesRead, Key: key,
                    PartNumber: partNumber, UploadId, Body: body,
                }));

                if ( !ETag ) throw new Error(`No ETag for ${filePath} part ${partNumber}`);
                uploadedParts.push({ ETag, PartNumber: partNumber });

                offset += bytesRead;
                partNumber++;
            }

            await client.send(new CompleteMultipartUploadCommand({
                Bucket: bucket, Key: key, UploadId,
                MultipartUpload: { Parts: uploadedParts },
            }));
        } catch ( error ) {
            await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId })).catch(() => {});
            throw error;
        } finally {
            await fileHandle.close();
        }
    }
}
