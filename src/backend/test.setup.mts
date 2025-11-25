// setup.ts - Vitest global setup for Puter API tests (TypeScript)
import { beforeAll } from 'vitest';
// @ts-ignore
import { Kernel } from './src/Kernel.js';
// @ts-ignore
import {k} from './tools/test.mjs';

let testKernel = {} as Kernel;
beforeAll(async () => {
    console.log("initted with kernel:" ,k)
    testKernel = await k;
});

export { testKernel };