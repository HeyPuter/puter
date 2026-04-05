/*
 * Copyright (C) 2024-present Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const { describe, it, expect, beforeEach, afterEach } = require('vitest');
const EnvConfigParser = require('./EnvConfigParser');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('EnvConfigParser', () => {
    let tempDir;
    let originalEnv;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puter-test-'));
        originalEnv = { ...process.env };
        // Clear relevant env vars
        delete process.env.PUTER_DOMAIN;
        delete process.env.MAIN_DOMAIN;
        delete process.env.SSL_ENABLED;
        delete process.env.PUTER_SSL;
        delete process.env.PUTER_API_ROUTING;
        delete process.env.API_ROUTING;
        delete process.env.PORT;
        delete process.env.HTTP_PORT;
        delete process.env.PUBLIC_PORT;
        delete process.env.PUB_PORT;
        delete process.env.SERVER_ID;
        delete process.env.CONTACT_EMAIL;
        delete process.env.NODE_ENV;
    });

    afterEach(() => {
        // Restore env
        Object.keys(process.env).forEach(key => {
            if (!(key in originalEnv)) {
                delete process.env[key];
            }
        });
        Object.assign(process.env, originalEnv);
        
        // Clean up temp directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true });
        }
    });

    describe('Domain Configuration', () => {
        it('should use PUTER_DOMAIN if set', () => {
            process.env.PUTER_DOMAIN = 'puter.example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.domain).toBe('puter.example.com');
        });

        it('should use MAIN_DOMAIN as fallback', () => {
            process.env.MAIN_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.domain).toBe('example.com');
        });

        it('should use default domain if neither is set', () => {
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.domain).toBe('puter.localhost');
        });

        it('should normalize domain to lowercase', () => {
            process.env.PUTER_DOMAIN = 'PUTER.EXAMPLE.COM';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.domain).toBe('puter.example.com');
        });
    });

    describe('SSL/Protocol Configuration', () => {
        it('should set protocol to https when SSL_ENABLED is true', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.SSL_ENABLED = 'true';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.protocol).toBe('https');
            expect(config.nginx_mode).toBe(false);
        });

        it('should set protocol to http when SSL_ENABLED is false', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.SSL_ENABLED = 'false';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.protocol).toBe('http');
            expect(config.nginx_mode).toBe(true);
        });

        it('should handle various truthy values for SSL_ENABLED', () => {
            const truthyValues = ['1', 'yes', 'YES', 'True', 'TRUE'];
            for (const value of truthyValues) {
                process.env.PUTER_DOMAIN = 'example.com';
                process.env.SSL_ENABLED = value;
                const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
                const config = parser.parse();
                expect(config.protocol).toBe('https');
            }
        });

        it('should use PUTER_SSL as alternative to SSL_ENABLED', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PUTER_SSL = 'true';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.protocol).toBe('https');
        });
    });

    describe('API Routing Configuration', () => {
        it('should set subdomain mode as default', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.experimental_no_subdomain).toBe(false);
        });

        it('should enable subdomain mode with explicit subdomain option', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PUTER_API_ROUTING = 'subdomain';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.experimental_no_subdomain).toBe(false);
        });

        it('should enable path mode with path option', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PUTER_API_ROUTING = 'path';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.experimental_no_subdomain).toBe(true);
            expect(config.api_path_prefix).toBe('/api');
        });

        it('should handle path-based option', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PUTER_API_ROUTING = 'path-based';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.experimental_no_subdomain).toBe(true);
        });

        it('should reject invalid API_ROUTING values', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PUTER_API_ROUTING = 'invalid-mode';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            expect(() => parser.parse()).toThrow();
        });
    });

    describe('Port Configuration', () => {
        it('should use auto port by default', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.http_port).toBe('auto');
        });

        it('should parse PORT as number', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = '4000';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.http_port).toBe(4000);
        });

        it('should use HTTP_PORT as fallback', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.HTTP_PORT = '8080';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.http_port).toBe(8080);
        });

        it('should reject invalid port numbers', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = 'invalid';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            expect(() => parser.parse()).toThrow();
        });

        it('should reject port 0', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = '0';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            expect(() => parser.parse()).toThrow();
        });

        it('should reject port > 65535', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = '70000';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            expect(() => parser.parse()).toThrow();
        });
    });

    describe('Public Port Configuration', () => {
        it('should default to http port if numeric', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = '4000';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.pub_port).toBe(4000);
        });

        it('should default to 80 for http auto port', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = 'auto';
            process.env.SSL_ENABLED = 'false';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.pub_port).toBe(80);
        });

        it('should default to 443 for https auto port', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = 'auto';
            process.env.SSL_ENABLED = 'true';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.pub_port).toBe(443);
        });

        it('should use PUBLIC_PORT if explicitly set', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.PORT = '4000';
            process.env.PUBLIC_PORT = '443';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.pub_port).toBe(443);
        });
    });

    describe('Server Configuration', () => {
        it('should set default server_id', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.server_id).toBe('puter-server');
        });

        it('should use SERVER_ID if set', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.SERVER_ID = 'custom-server';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.server_id).toBe('custom-server');
        });

        it('should set contact_email from domain', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.contact_email).toBe('hey@example.com');
        });

        it('should use CONTACT_EMAIL if set', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.CONTACT_EMAIL = 'admin@example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.contact_email).toBe('admin@example.com');
        });
    });

    describe('Environment Mode', () => {
        it('should default to dev', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.env).toBe('dev');
        });

        it('should use NODE_ENV if set', () => {
            process.env.PUTER_DOMAIN = 'example.com';
            process.env.NODE_ENV = 'production';
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            expect(config.env).toBe('production');
        });
    });

    describe('.env File Parsing', () => {
        it('should load variables from .env file', () => {
            const envContent = 'PUTER_DOMAIN=file.example.com\nSSL_ENABLED=true\n';
            fs.writeFileSync(path.join(tempDir, '.env'), envContent);
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('file.example.com');
            expect(config.protocol).toBe('https');
        });

        it('should handle quoted values in .env', () => {
            const envContent = 'PUTER_DOMAIN="quoted.example.com"\n';
            fs.writeFileSync(path.join(tempDir, '.env'), envContent);
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('quoted.example.com');
        });

        it('should ignore comments in .env', () => {
            const envContent = `# This is a comment
PUTER_DOMAIN=example.com
# Another comment
SSL_ENABLED=true`;
            fs.writeFileSync(path.join(tempDir, '.env'), envContent);
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('example.com');
            expect(config.protocol).toBe('https');
        });

        it('should handle values with equals signs', () => {
            const envContent = 'JWT_SECRET=key=with=equals\n';
            fs.writeFileSync(path.join(tempDir, '.env'), envContent);
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            // Custom env to override domain
            process.env.PUTER_DOMAIN = 'example.com';
            const config = parser.parse();
            
            expect(config.domain).toBe('example.com');
        });

        it('should use process.env over .env file', () => {
            const envContent = 'PUTER_DOMAIN=file.example.com\n';
            fs.writeFileSync(path.join(tempDir, '.env'), envContent);
            process.env.PUTER_DOMAIN = 'env.example.com';
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('env.example.com');
        });
    });

    describe('Configuration Validation', () => {
        it('should validate required domain field', () => {
            const invalidConfig = { protocol: 'https' };
            expect(() => EnvConfigParser.validate(invalidConfig)).toThrow('domain');
        });

        it('should validate protocol field', () => {
            const invalidConfig = { domain: 'example.com' };
            expect(() => EnvConfigParser.validate(invalidConfig)).toThrow('protocol');
        });

        it('should validate protocol is http or https', () => {
            const invalidConfig = { domain: 'example.com', protocol: 'ftp' };
            expect(() => EnvConfigParser.validate(invalidConfig)).toThrow('protocol');
        });

        it('should pass valid configuration', () => {
            const validConfig = { domain: 'example.com', protocol: 'https' };
            expect(() => EnvConfigParser.validate(validConfig)).not.toThrow();
        });
    });

    describe('Integration Scenarios', () => {
        it('should handle complete production setup', () => {
            process.env.PUTER_DOMAIN = 'puter.example.com';
            process.env.SSL_ENABLED = 'true';
            process.env.PUTER_API_ROUTING = 'path';
            process.env.PORT = '4000';
            process.env.PUBLIC_PORT = '443';
            process.env.NODE_ENV = 'production';
            process.env.SERVER_ID = 'prod-1';
            process.env.CONTACT_EMAIL = 'support@example.com';
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('puter.example.com');
            expect(config.protocol).toBe('https');
            expect(config.experimental_no_subdomain).toBe(true);
            expect(config.http_port).toBe(4000);
            expect(config.pub_port).toBe(443);
            expect(config.env).toBe('production');
            expect(config.server_id).toBe('prod-1');
            expect(config.contact_email).toBe('support@example.com');
        });

        it('should handle complete development setup', () => {
            process.env.PUTER_DOMAIN = 'puter.localhost';
            process.env.SSL_ENABLED = 'false';
            process.env.PUTER_API_ROUTING = 'subdomain';
            process.env.PORT = '4100';
            process.env.NODE_ENV = 'dev';
            
            const parser = new EnvConfigParser({ envPath: path.join(tempDir, '.env') });
            const config = parser.parse();
            
            expect(config.domain).toBe('puter.localhost');
            expect(config.protocol).toBe('http');
            expect(config.experimental_no_subdomain).toBe(false);
            expect(config.http_port).toBe(4100);
            expect(config.env).toBe('dev');
        });
    });

    describe('Documentation', () => {
        it('should provide documentation', () => {
            const doc = EnvConfigParser.getDocumentation();
            expect(doc).toContain('Puter Environment Configuration');
            expect(doc).toContain('PUTER_DOMAIN');
            expect(doc).toContain('SSL_ENABLED');
            expect(doc).toContain('PUTER_API_ROUTING');
        });
    });
});
