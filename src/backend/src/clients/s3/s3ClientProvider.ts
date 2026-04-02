import { PutObjectCommand, S3Client, S3ClientConfig } from '@aws-sdk/client-s3';
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

let awsClientConfig: Partial<S3ClientConfig>;
let fauxqsServer: FauxqsServer;
let configInitialized = false;

const s3ClientMap = new Map<string, S3Client>();

export const s3ClientProvider = (region: string = 'us-west-2') => {
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
};

export const initializeS3Config = async (forceLocalInMem = false) => {
    if ( configInitialized ) return;

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
        // Development mode - start fauxqs
        fauxqsServer = await startFauxqs({
            port: 4566,
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
            const legacyPath = path.join(process.cwd(), 'storage');
            const client = s3ClientProvider();
            // Read through each file and add to fauxqs S3 bucket in esm
            if ( existsSync(legacyPath) ) {
                const files = await fs.readdir(legacyPath);
                for ( const file of files ) {
                    const filePath = path.join(legacyPath, file);
                    const stat = await fs.stat(filePath);
                    if ( ! stat.isFile() ) continue;

                    const body = await fs.readFile(filePath);
                    await client.send(new PutObjectCommand({
                        Bucket: 'puter-local',
                        Key: file,
                        Body: body,
                    }));
                }
                await fs.rm(legacyPath, { recursive: true });
                console.log(`Migrated ${files.length} file(s) from legacy storage to S3.`);
            }
        }

    }
    configInitialized = true;
};
