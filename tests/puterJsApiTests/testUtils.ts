
// testUtils.ts - Puter.js API test utilities (TypeScript)
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import type { Puter } from '../../src/puter-js/index.js';

// Create and configure a global puter instance from client-config.yaml
// Usage: import { puter } from './testUtils'
// Configuration is read from tests/client-config.yaml

// Load configuration from YAML file
let config: Record<string, string>;
try {
    const configPath = path.join(__dirname, '../client-config.yaml');
    config = yaml.parse(fs.readFileSync(configPath, 'utf8'));
} catch ( error ) {
    console.error('Failed to load client-config.yaml:', error);
    process.exit(1);
}

const puter: Puter = require('../../src/puter-js/src/index.js').default || (globalThis as unknown as { puter: Puter }).puter;

(globalThis as Record<string, unknown>).PUTER_ORIGIN = config.frontend_url;
(globalThis as Record<string, unknown>).PUTER_API_ORIGIN = config.api_url;

(puter as unknown as { setAPIOrigin: (a: string) => void }).setAPIOrigin(config.api_url);
(puter as unknown as { defaultGUIOrigin: string }).defaultGUIOrigin = config.frontend_url;

if ( config.auth_token ) {
    (puter as unknown as { setAuthToken: (a: string) => void }).setAuthToken(config.auth_token);
}

export { puter };
