// testUtils.ts - Puter.js API test utilities (TypeScript)
import type { Puter } from '../../src/puter-js';

// Create and configure a global puter instance from environment variables
// Usage: import { puter } from './testUtils'
// Environment variables: PUTER_AUTH_TOKEN, PUTER_API_ORIGIN, PUTER_ORIGIN

// @ts-ignore
const puter: Puter = require('../../src/puter-js/src/index.js').default || globalThis.puter;
globalThis.PUTER_ORIGIN = process.env.PUTER_ORIGIN || 'https://puter.com';
globalThis.PUTER_API_ORIGIN = process.env.PUTER_API_ORIGIN || 'https://api.puter.com';
if (process.env.PUTER_API_ORIGIN) (puter as any).setAPIOrigin(process.env.PUTER_API_ORIGIN);
if (process.env.PUTER_ORIGIN) (puter as any).defaultGUIOrigin = process.env.PUTER_ORIGIN;
if (process.env.PUTER_AUTH_TOKEN) (puter as any).setAuthToken(process.env.PUTER_AUTH_TOKEN);

export { puter };
