/**
 * Legacy filesystem type registration.
 *
 * Registers the 'puterfs' filesystem type which backs user files with
 * S3 storage. Internal controllers/providers live in the old
 * extensions/legacyFileSystem/ directory and are imported from there.
 */

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck — old extension modules have no type declarations
import FSEntryController from '../../../../../extensions/legacyFileSystem/fsentries/FSEntryController.js';
import PuterFSProvider from '../../../../../extensions/legacyFileSystem/PuterFSProvider.js';
import ProxyStorageController from '../../../../../extensions/legacyFileSystem/storage/ProxyStorageController.js';
import S3StorageController from '../../../../../extensions/legacyFileSystem/storage/S3StorageController.js';
import { extension } from '../extensions.js';

const clients = extension.import('client');

const fsEntryController = new FSEntryController();
const storageController = new ProxyStorageController();

extension.on('init', async () => {
    fsEntryController.init();

    let defaultStorage = 'S3';
    const storageStrategies: Record<string, any> = {
        S3: new S3StorageController(),
    };

    const event = {
        createStorageStrategy (name: string, implementation: any) {
            storageStrategies[name] = implementation;
            if ( implementation === undefined ) {
                throw new Error('createStorageStrategy was called wrong');
            }
            if ( implementation.forceDefault ) {
                defaultStorage = name;
            }
        },
    };
    await clients.event.emit('puterfs.storage.create', event, {});

    const configuredStorage = (extension.config as any).storage ?? defaultStorage;
    const storageToUse = storageStrategies[configuredStorage];
    storageController.setDelegate(storageToUse);
    await storageController.init();
});

extension.on('create.filesystem-types', (event: any) => {
    const fsProvider = new PuterFSProvider({ fsEntryController, storageController });
    event.createFilesystemType('puterfs', {
        mount () { return fsProvider; },
    });
});
