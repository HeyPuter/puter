// testUtils.ts - Puter.js API test utilities (TypeScript)
import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import type { Puter } from '../../src/puter-js';

// Create and configure a global puter instance from environment variables and config file
// Usage: import { puter } from './testUtils'
// Environment variables: PUTER_AUTH_TOKEN, PUTER_API_ORIGIN, PUTER_ORIGIN
// Config file: tests/client-config.yaml

// Load config from YAML file
let config: any = {};
try {
  const configPath = path.join(__dirname, '../client-config.yaml');
  const configFile = fs.readFileSync(configPath, 'utf8');
  config = yaml.load(configFile);
} catch (error) {
  console.warn('Could not load client-config.yaml, using defaults');
}

// @ts-ignore
const puter: Puter = require('../../src/puter-js/src/index.js').default || globalThis.puter;
globalThis.PUTER_ORIGIN = process.env.PUTER_ORIGIN || config.frontend_url || 'https://puter.com';
globalThis.PUTER_API_ORIGIN = process.env.PUTER_API_ORIGIN || config.api_url || 'https://api.puter.com';
if (process.env.PUTER_API_ORIGIN || config.api_url) (puter as any).setAPIOrigin(process.env.PUTER_API_ORIGIN || config.api_url);
if (process.env.PUTER_ORIGIN || config.frontend_url) (puter as any).defaultGUIOrigin = process.env.PUTER_ORIGIN || config.frontend_url;
if (process.env.PUTER_AUTH_TOKEN || config.auth_token) (puter as any).setAuthToken(process.env.PUTER_AUTH_TOKEN || config.auth_token);

export { puter };
