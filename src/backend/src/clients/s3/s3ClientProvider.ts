import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand,
    PutObjectCommand,
    S3Client,
    S3ClientConfig,
    UploadPartCommand,
} from '@aws-sdk/client-s3';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { FauxqsServer, startFauxqs } from 'fauxqs';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { Agent as httpsAgent } from 'node:https';
import path from 'node:path';

// Configuration
const s3Endpoint = process.env.S3_ENDPOINT;
const s3Credentials = process.env.S3_CREDENTIALS ? JSON.parse(process.env.S3_CREDENTIALS) : undefined;
const useProviderChain = process.env.S3_USE_PROVIDER_CHAIN === 'true';
const LEGACY_STORAGE_BUCKET = 'puter-local';
const FAUXQS_SAFE_PUT_OBJECT_LIMIT_BYTES = 10 * 1024 * 1024;
const DEFAULT_MULTIPART_PART_SIZE_BYTES = 5 * 1024 * 1024;

let awsClientConfig: Partial<S3ClientConfig>;
let fauxqsServer: FauxqsServer;
let configInitialized = false;
let configInitializationPromise: Promise<void> | null = null;

const s3ClientMap = new Map<string, S3Client>();

type S3CommandSender = Pick<S3Client, 'send'>;
interface MigrateLegacyStorageOptions {
    bucket?: string;
    client?: S3CommandSender;
    existsSyncImpl?: typeof existsSync;
    fsImpl?: typeof fs;
    legacyPath?: string;
    multipartPartSizeBytes?: number;
    putObjectLimitBytes?: number;
}

interface LegacyStorageMigrationResult {
    migratedFileCount: number;
    scannedEntryCount: number;
}

const uploadFileMultipart = async ({
    bucket,
    client,
    filePath,
    fileSize,
    fsImpl,
    key,
    partSizeBytes,
}: {
    bucket: string;
    client: S3CommandSender;
    filePath: string;
    fileSize: number;
    fsImpl: typeof fs;
    key: string;
    partSizeBytes: number;
}) => {
    const createMultipartResult = await client.send(new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
    }));
    const uploadId = createMultipartResult.UploadId;
    if ( ! uploadId ) {
        throw new Error(`Failed to start multipart upload for ${filePath}`);
    }

    const uploadedParts: { ETag: string; PartNumber: number; }[] = [];
    const fileHandle = await fsImpl.open(filePath, 'r');

    try {
        let offset = 0;
        let partNumber = 1;

        while ( offset < fileSize ) {
            const partLength = Math.min(partSizeBytes, fileSize - offset);
            const partBuffer = Buffer.alloc(partLength);
            const { bytesRead } = await fileHandle.read(partBuffer, 0, partLength, offset);

            if ( bytesRead <= 0 ) break;

            const uploadPartResult = await client.send(new UploadPartCommand({
                Bucket: bucket,
                ContentLength: bytesRead,
                Key: key,
                PartNumber: partNumber,
                UploadId: uploadId,
                Body: bytesRead === partBuffer.length
                    ? partBuffer
                    : partBuffer.subarray(0, bytesRead),
            }));

            if ( ! uploadPartResult.ETag ) {
                throw new Error(`Multipart upload returned no ETag for ${filePath} part ${partNumber}`);
            }

            uploadedParts.push({
                ETag: uploadPartResult.ETag,
                PartNumber: partNumber,
            });

            offset += bytesRead;
            partNumber++;
        }

        await client.send(new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: uploadedParts,
            },
        }));
    } catch ( error ) {
        await client.send(new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
        })).catch(() => undefined);
        throw error;
    } finally {
        await fileHandle.close();
    }
};
export const s3ClientProvider = {
    get: (region: string = 'us-west-2') => {
    // Initialize config on first call

        if ( s3ClientMap.has(region) ) {
            return s3ClientMap.get(region)!;
        }

        try {
            const s3Client = new S3Client({
                region,
                requestStreamBufferSize: 32 * 1024,
                requestHandler: new NodeHttpHandler({
                    socketTimeout: 5000,
                    httpsAgent: new httpsAgent({
                        maxSockets: 500,
                        keepAlive: true,
                        keepAliveMsecs: 1000,
                    }),
                }),
                ...awsClientConfig,
            });

            s3ClientMap.set(region, s3Client);
            return s3Client;
        } catch ( error ) {
            console.error('Failed to create S3 client:', error);
            throw new Error(`Failed to initialize S3 client for region ${region}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    },
    partSize: useProviderChain ? 64 * 1024 * 1024 : DEFAULT_MULTIPART_PART_SIZE_BYTES,
    maxSingleUploadSize: useProviderChain ? 128 * 1024 * 1024 : FAUXQS_SAFE_PUT_OBJECT_LIMIT_BYTES,
};

export const migrateLegacyStorageToS3 = async ({
    bucket = LEGACY_STORAGE_BUCKET,
    client = s3ClientProvider.get(),
    existsSyncImpl = existsSync,
    fsImpl = fs,
    legacyPath = path.join(process.cwd(), 'storage'),
    multipartPartSizeBytes = s3ClientProvider.partSize,
    putObjectLimitBytes = s3ClientProvider.maxSingleUploadSize,
}: MigrateLegacyStorageOptions = {}): Promise<LegacyStorageMigrationResult> => {
    if ( ! existsSyncImpl(legacyPath) ) {
        return {
            migratedFileCount: 0,
            scannedEntryCount: 0,
        };
    }

    const entries = await fsImpl.readdir(legacyPath);
    let migratedFileCount = 0;

    for ( const entryName of entries ) {
        const filePath = path.join(legacyPath, entryName);
        const stat = await fsImpl.stat(filePath);
        if ( ! stat.isFile() ) continue;

        if ( stat.size > putObjectLimitBytes ) {
            await uploadFileMultipart({
                bucket,
                client,
                filePath,
                fileSize: stat.size,
                fsImpl,
                key: entryName,
                partSizeBytes: multipartPartSizeBytes,
            });
        } else {
            const body = await fsImpl.readFile(filePath);
            await client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: entryName,
                Body: body,
            }));
        }

        migratedFileCount++;
    }

    await fsImpl.rm(legacyPath, { recursive: true });
    return {
        migratedFileCount,
        scannedEntryCount: entries.length,
    };
};

export const initializeS3Config = async (forceLocalInMem = false) => {

    if ( configInitialized ) return;
    if ( configInitializationPromise ) return configInitializationPromise;

    configInitializationPromise = (async () => {
        // Check if we should use fauxqs (no endpoint and no credentials configured)
        const shouldUseS3Endpoint = s3Endpoint && s3Credentials;

        if ( !forceLocalInMem && useProviderChain ) {
            awsClientConfig = {
                credentials: fromNodeProviderChain(),
            };
        } else if ( !forceLocalInMem && shouldUseS3Endpoint ) {
            awsClientConfig = {
                endpoint: s3Endpoint,
                credentials: s3Credentials,
            };
        } else {
            console.log('No S3 endpoint or credentials configured, starting fauxqs for local S3 dev...');

            const configuredFauxqsPort = Number.parseInt(
                process.env.S3_FAUXQS_PORT ?? '',
                10,
            );
            const fauxqsHost = forceLocalInMem ? '127.0.0.1' : process.env.S3_FAUXQS_HOST;
            const fauxqsPort = forceLocalInMem
                ? 0
                : Number.isFinite(configuredFauxqsPort)
                    ? configuredFauxqsPort
                    : 4566;

            fauxqsServer = await startFauxqs({
                host: fauxqsHost,
                port: fauxqsPort,
                logger: false,
                dataDir: forceLocalInMem ? undefined : './fauxqs-data',
                s3StorageDir: forceLocalInMem ? undefined : './fauxqs-s3-data',
                init: {
                    region: 'us-west-2',
                    buckets: [
                        'puter-local',
                    ],
                },
            });

            awsClientConfig = {
                endpoint: fauxqsServer.address,
                credentials: {
                    accessKeyId: 'fakeAccessKeyId',
                    secretAccessKey: 'fakeSecretAccessKey',
                },
            };

            // Gracefully stop server on SIGINT, SIGTERM, or SIGABRT
            const shutdown = async () => {
                if ( fauxqsServer ) {
                    await fauxqsServer.stop();
                }
            };
            process.on('SIGINT', shutdown);
            process.on('SIGTERM', shutdown);
            process.on('SIGABRT', shutdown);

            // migrate to s3 if files exist in old local directory (legacy from before fauxqs)
            if ( ! forceLocalInMem ) {
                const client = s3ClientProvider.get();
                const migrationResult = await migrateLegacyStorageToS3({ client });
                if ( migrationResult.migratedFileCount > 0 ) {
                    console.log(`Migrated ${migrationResult.migratedFileCount} file(s) from legacy storage to S3.`);
                }
            }

        }
        configInitialized = true;
    })();

    try {
        await configInitializationPromise;
    } catch ( error ) {
        configInitializationPromise = null;
        throw error;
    }
};
