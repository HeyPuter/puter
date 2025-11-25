// setup.ts - Vitest global setup for Puter API tests (TypeScript)
import { beforeAll } from 'vitest';
import { k } from './tools/test.mjs';
let testKernel = {};
beforeAll(async () => {
    console.log("initted with kernel:", k);
    testKernel = await k;
});
export { testKernel };
//# sourceMappingURL=test.setup.mjs.map