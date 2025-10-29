// testUtils.ts - Puter.js API test utilities (TypeScript)
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Puter } from '../../src/puter-js/index.js';

// Create and configure a global puter instance from client-config.yaml
// Usage: import { puter } from './testUtils'
// Configuration is read from tests/client-config.yaml

// Load configuration from YAML file
let config: any;
try {
    const configPath = path.join(__dirname, '../client-config.yaml');
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
    console.error('Failed to load client-config.yaml:', error);
    process.exit(1);
}

// @ts-ignore
const puter: Puter = require('../../src/puter-js/src/index.js').default || globalThis.puter;

(globalThis as any).PUTER_ORIGIN = config.frontend_url;
(globalThis as any).PUTER_API_ORIGIN = config.api_url;

(puter as any).setAPIOrigin(config.api_url);
(puter as any).defaultGUIOrigin = config.frontend_url;

if (config.auth_token) {
    (puter as any).setAuthToken(config.auth_token);
}

export { puter };
