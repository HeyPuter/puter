/**
 * FSv2 extension — filesystem controller, repository, and service.
 *
 * Internal modules (FSController, FSEntryRepository, S3StorageProvider,
 * FSEntryService, FSEntryCacheInvalidationEventHandler) live in the old
 * extensions/fsv2/ directory and are imported from there.
 */

import { FSController } from '../../../../../extensions/fsv2/src/controllers/FSController.js';
import { FSEntryCacheInvalidationEventHandler } from '../../../../../extensions/fsv2/src/eventHandlers/FSEntryCacheInvalidationEventHandler.js';
import { FSEntryRepository } from '../../../../../extensions/fsv2/src/repositories/FSEntryRepository.js';
import { S3StorageProvider } from '../../../../../extensions/fsv2/src/repositories/S3FileStorageRepository.js';
import { FSEntryService } from '../../../../../extensions/fsv2/src/services/FSEntryService.js';
import { extension } from '../extensions.js';

const clients = extension.import('client');
const stores  = extension.import('store');

// The internal fsv2 classes still expect v1 type signatures (BaseDatabaseAccessService,
// EventService). The v2 clients are wire-compatible — cast through `any` for now.
// These casts go away once the fsv2 internals are ported to v2 types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsEntryRepository = new FSEntryRepository(clients.db as any, clients.redis as any, stores.kv as any);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s3StorageProvider = new S3StorageProvider(clients.s3 as any);
const fsEntryService = new FSEntryService(fsEntryRepository, s3StorageProvider);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fsController = new FSController(fsEntryService, clients.event as any);
(fsController as unknown as { registerRoutes: () => void }).registerRoutes();
new FSEntryCacheInvalidationEventHandler(fsEntryRepository);
