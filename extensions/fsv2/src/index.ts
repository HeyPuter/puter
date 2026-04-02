import type { DynamoKVStore } from '@heyputer/backend/src/services/DynamoKVStore/DynamoKVStore.js';
import { FSController } from './controllers/FSController.js';
import { FSEntryCacheInvalidationEventHandler } from './eventHandlers/FSEntryCacheInvalidationEventHandler.js';
import { FSEntryRepository } from './repositories/FSEntryRepository.js';
import { S3StorageProvider } from './repositories/S3FileStorageRepository.js';
import { FSEntryService } from './services/FSEntryService.js';

const databaseService = extension.import('service:database');
const { cache, s3ClientProvider } = extension.import('data');
const eventService = extension.import('service:event');
const kvStore = extension.import('service:puter-kvstore') as DynamoKVStore;
const filesystemDb = databaseService;

const fsEntryRepository = new FSEntryRepository(filesystemDb, cache, kvStore);
const s3StorageProvider = new S3StorageProvider(s3ClientProvider);
const fsEntryService = new FSEntryService(fsEntryRepository, s3StorageProvider);

const fsController = new FSController(fsEntryService, eventService);
(fsController as unknown as { registerRoutes: () => void }).registerRoutes();
new FSEntryCacheInvalidationEventHandler(fsEntryRepository);
