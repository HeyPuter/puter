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

const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * EnvConfigParser
 * 
 * Parses environment variables and .env file to generate Puter configuration.
 * This centralizes the handling of domain routing, API endpoints, and SSL settings.
 */
class EnvConfigParser {
    constructor(options = {}) {
        this.envPath = options.envPath || '.env';
        this.env = process.env;
    }

    /**
     * Parse environment configuration and return merged config object
     * @returns {Object} Configuration object to be merged with defaults
     */
    parse() {
        const envVars = this._loadEnvVars();
        const config = {};

        // Main domain configuration
        config.domain = this._parseDomain(envVars);
        
        // SSL/Protocol configuration
        config.protocol = this._parseProtocol(envVars);
        config.nginx_mode = !this._isSSLEnabled(envVars); // nginx_mode means "serve http"
        
        // API routing configuration
        const apiConfig = this._parseApiRouting(envVars, config);
        Object.assign(config, apiConfig);
        
        // Port configuration
        config.http_port = this._parsePort(envVars);
        config.pub_port = this._parsePublicPort(envVars, config);

        // Environment mode
        config.env = this._parseEnv(envVars);

        // Always set required fields
        if (!config.server_id) {
            config.server_id = envVars.SERVER_ID || 'puter-server';
        }
        if (!config.contact_email) {
            config.contact_email = envVars.CONTACT_EMAIL || `hey@${config.domain}`;
        }

        return config;
    }

    /**
     * Load environment variables from .env file and process.env
     * @private
     * @returns {Object} Environment variables
     */
    _loadEnvVars() {
        const envVars = { ...process.env };
        
        // Check if .env file exists and load it
        if (fs.existsSync(this.envPath)) {
            const envContent = fs.readFileSync(this.envPath, 'utf-8');
            const envLines = envContent.split('\n');
            
            for (const line of envLines) {
                const line_trimmed = line.trim();
                if (!line_trimmed || line_trimmed.startsWith('#')) continue;
                
                const [key, ...valueParts] = line_trimmed.split('=');
                const value = valueParts.join('=').trim();
                
                // Remove quotes if present
                const cleanValue = value
                    .replace(/^["']|["']$/g, '')
                    .replace(/^\\["']|["']\\$/g, '');
                
                if (key && !envVars[key]) {
                    envVars[key] = cleanValue;
                }
            }
        }
        
        return envVars;
    }

    /**
     * Parse main domain from environment
     * @private
     * @param {Object} envVars
     * @returns {string} Domain
     */
    _parseDomain(envVars) {
        const domain = envVars.PUTER_DOMAIN 
            || envVars.MAIN_DOMAIN 
            || 'puter.localhost';
        
        if (!domain) {
            throw new Error('PUTER_DOMAIN or MAIN_DOMAIN must be set');
        }
        
        return domain.toLowerCase().trim();
    }

    /**
     * Parse protocol (http/https) from environment
     * @private
     * @param {Object} envVars
     * @returns {string} Protocol ('http' or 'https')
     */
    _parseProtocol(envVars) {
        if (this._isSSLEnabled(envVars)) {
            return 'https';
        }
        return 'http';
    }

    /**
     * Check if SSL is enabled
     * @private
     * @param {Object} envVars
     * @returns {boolean}
     */
    _isSSLEnabled(envVars) {
        const sslValue = (envVars.SSL_ENABLED 
            || envVars.PUTER_SSL 
            || 'false').toLowerCase();
        
        return sslValue === 'true' || sslValue === '1' || sslValue === 'yes';
    }

    /**
     * Parse API routing configuration
     * @private
     * @param {Object} envVars
     * @param {Object} partialConfig
     * @returns {Object} API routing configuration
     */
    _parseApiRouting(envVars, partialConfig) {
        const config = {};
        const apiRoutingMode = (envVars.PUTER_API_ROUTING 
            || envVars.API_ROUTING 
            || 'subdomain').toLowerCase().trim();

        if (apiRoutingMode === 'path' || apiRoutingMode === 'path-based' || apiRoutingMode === '/api') {
            // Path-based API routing: example.com/api
            config.experimental_no_subdomain = true;
            config.api_path_prefix = '/api';
        } else if (apiRoutingMode === 'subdomain' || apiRoutingMode === 'api-subdomain') {
            // Subdomain-based API routing: api.example.com (default)
            config.experimental_no_subdomain = false;
        } else {
            throw new Error(
                `Invalid PUTER_API_ROUTING value: "${apiRoutingMode}". ` +
                'Expected: "subdomain" or "path"'
            );
        }

        return config;
    }

    /**
     * Parse HTTP port configuration
     * @private
     * @param {Object} envVars
     * @returns {string|number} Port or 'auto'
     */
    _parsePort(envVars) {
        const port = envVars.PORT || envVars.HTTP_PORT || 'auto';
        
        if (port === 'auto') {
            return 'auto';
        }

        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            throw new Error(`Invalid PORT: ${port}. Must be a number between 1 and 65535`);
        }

        return portNum;
    }

    /**
     * Parse public port (the port exposed to clients)
     * @private
     * @param {Object} envVars
     * @param {Object} partialConfig
     * @returns {number}
     */
    _parsePublicPort(envVars, partialConfig) {
        const pubPort = envVars.PUBLIC_PORT || envVars.PUB_PORT;
        
        if (!pubPort) {
            // Default: use http port if it's a number, otherwise 80/443
            if (typeof partialConfig.http_port === 'number') {
                return partialConfig.http_port;
            }
            return partialConfig.protocol === 'https' ? 443 : 80;
        }

        const portNum = parseInt(pubPort, 10);
        if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
            throw new Error(`Invalid PUBLIC_PORT: ${pubPort}. Must be a number between 1 and 65535`);
        }

        return portNum;
    }

    /**
     * Parse environment mode (dev, prod, etc)
     * @private
     * @param {Object} envVars
     * @returns {string}
     */
    _parseEnv(envVars) {
        return (envVars.NODE_ENV || envVars.ENV || 'dev').toLowerCase();
    }

    /**
     * Validate final configuration
     * @param {Object} config
     * @throws {Error} If configuration is invalid
     */
    static validate(config) {
        if (!config.domain) {
            throw new Error('Configuration missing required field: domain');
        }
        if (!config.protocol) {
            throw new Error('Configuration missing required field: protocol');
        }
        if (config.protocol !== 'http' && config.protocol !== 'https') {
            throw new Error(`Invalid protocol: ${config.protocol}. Must be 'http' or 'https'`);
        }
    }

    /**
     * Get configuration schema documentation
     * @static
     * @returns {string} Documentation of available environment variables
     */
    static getDocumentation() {
        return `
Puter Environment Configuration
================================

Main Domain Configuration:
  PUTER_DOMAIN or MAIN_DOMAIN (required)
    - The main domain where Puter will be hosted
    - Examples: "puter.example.com", "mycloud.local", "puter.localhost"

SSL/Protocol Configuration:
  SSL_ENABLED or PUTER_SSL (optional, default: false)
    - Enable HTTPS support
    - Values: true, false, 1, 0, yes, no
    - Example: SSL_ENABLED=true

API Routing Configuration:
  PUTER_API_ROUTING or API_ROUTING (optional, default: "subdomain")
    - How to route API endpoints
    - Options:
      * "subdomain" - Use api.domain.com (default)
      * "path" - Use domain.com/api
    - Example: PUTER_API_ROUTING=path

Port Configuration:
  PORT or HTTP_PORT (optional, default: "auto")
    - The port Puter backend listens on
    - Values: "auto" or a port number (1-65535)
    - Example: PORT=4000

  PUBLIC_PORT or PUB_PORT (optional)
    - The port exposed to clients (for reverse proxies)
    - If not set, defaults to PORT or 80/443
    - Example: PUBLIC_PORT=443

Server Configuration:
  SERVER_ID (optional)
    - Identifier for this server
    - Default: "puter-server"

  CONTACT_EMAIL (optional)
    - Contact email for the server
    - Default: "hey@{PUTER_DOMAIN}"

Environment Mode:
  NODE_ENV or ENV (optional, default: "dev")
    - Development environment: dev, prod, test, staging
    - Example: NODE_ENV=production

Example .env file:
  PUTER_DOMAIN=puter.example.com
  SSL_ENABLED=true
  PUTER_API_ROUTING=path
  PORT=4000
  PUBLIC_PORT=443
  NODE_ENV=production
`;
    }
}

module.exports = EnvConfigParser;
