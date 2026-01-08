import { createTestKernel } from './src/backend/tools/test.mjs';
import { WorkerService } from '@heyputer/backend/src/services/worker/WorkerService.js';
import { EntityStoreService } from './src/backend/src/services/EntityStoreService.js';
import { AppLimitedES } from './src/backend/src/om/entitystorage/AppLimitedES.js';
import { ESBuilder } from './src/backend/src/om/entitystorage/ESBuilder.js';
import MaxLimitES from './src/backend/src/om/entitystorage/MaxLimitES.js';
import SQLES from './src/backend/src/om/entitystorage/SQLES.js';
import { SetOwnerES } from './src/backend/src/om/entitystorage/SetOwnerES.js';
import SubdomainES from './src/backend/src/om/entitystorage/SubdomainES.js';
import ValidationES from './src/backend/src/om/entitystorage/ValidationES.js';
import WriteByOwnerOnlyES from './src/backend/src/om/entitystorage/WriteByOwnerOnlyES.js';
import { Actor, UserActorType } from './src/backend/src/services/auth/Actor.js';

trying();

async function trying() {
  const tk = await createTestKernel({
    serviceMap: { worker: WorkerService, 'es:subdomain': EntityStoreService },
    serviceMapArgs: {
      'es:subdomain': {
        entity: 'subdomain',
        upstream: ESBuilder.create([
          SQLES,
          { table: 'subdomains', debug: true },
          SubdomainES,
          AppLimitedES,
          WriteByOwnerOnlyES,
          ValidationES,
          SetOwnerES,
          MaxLimitES, { max: 5000 },
        ]),
      },
    },
    serviceConfigOverrideMap: {
      worker: { loggingUrl: 'x' },
      database: { path: ':memory:' },
    },
    initLevelString: 'init',
    testCore: true,
    globalConfigOverrideMap: {
      worker: { reserved_words: [] },
    },
  });

  const su = tk.services.get('su');
  const ws = tk.services.get('worker');
  const actor = new Actor({ type: new UserActorType({ user: { id: 1, uuid: 'u1', username: 'test' } }) });

  globalThis.services = tk.services;

  const res = await tk.root_context.arun(() => su.sudo(actor, () => ws.create({ filePath: '/worker.js', workerName: 'MyWorker', authorization: 'auth' })));
  console.log('result', res);
}
