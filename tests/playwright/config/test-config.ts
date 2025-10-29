import * as fs from 'fs'
import * as path from 'path'
import * as yaml from 'yaml'

// Strong-typed configuration interface
export interface TestConfig {
    api_url: string
    frontend_url: string
    username: string
    auth_token: string
}

// Singleton configuration loader - loads config only once
let config: TestConfig | null = null

export function getTestConfig(): TestConfig {
    if (config === null) {
        const configPath = path.join(__dirname, '../../client-config.yaml')
        const rawConfig = yaml.parse(fs.readFileSync(configPath, 'utf8'))
        
        // Validate required fields
        if (!rawConfig.api_url || !rawConfig.frontend_url || !rawConfig.username || !rawConfig.auth_token) {
            throw new Error('Invalid test configuration: missing required fields')
        }
        
        config = rawConfig as TestConfig
    }
    return config
}

// Export the typed configuration
export const testConfig: TestConfig = getTestConfig()
