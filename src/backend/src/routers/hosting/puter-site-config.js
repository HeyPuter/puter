/*
 * Copyright (C) 2026-present Puter Technologies Inc.
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
const path = require('path');

const ERROR_CLASS_REGEX = /^([45])xx$/i;
const STATUS_CODE_REGEX = /^[1-5][0-9][0-9]$/;

const createEmptyConfig = () => ({
    exactRules: Object.create(null),
    classRules: Object.create(null),
    defaultRule: null,
});

const normalizeStatusCode = value => {
    if ( value === undefined || value === null ) return null;

    const status = Number.parseInt(String(value), 10);
    if ( ! Number.isInteger(status) ) return null;
    if ( status < 100 || status > 599 ) return null;
    return status;
};

const normalizeFilePath = value => {
    if ( typeof value !== 'string' ) return null;

    let v = value.trim();
    if ( v === '' ) return null;
    if ( v.startsWith('@') ) return null;
    if ( /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v) ) return null;

    v = v.replaceAll('\\', '/');
    v = v.split('?')[0].split('#')[0];
    if ( ! v.startsWith('/') ) {
        v = `/${v}`;
    }

    const resolved = path.posix.resolve('/', v);
    if ( resolved === '/' ) return null;
    return resolved;
};

const normalizeRule = rawRule => {
    if ( rawRule === undefined || rawRule === null ) return null;

    if ( typeof rawRule === 'string' ) {
        const file = normalizeFilePath(rawRule);
        return file ? { file, status: null } : null;
    }

    if ( typeof rawRule === 'number' ) {
        const status = normalizeStatusCode(rawRule);
        return status ? { file: null, status } : null;
    }

    if ( typeof rawRule !== 'object' ) return null;

    const file = normalizeFilePath(
        rawRule.file ??
        rawRule.path ??
        rawRule.page ??
        rawRule.responsePagePath ??
        rawRule.response_page_path ??
        rawRule.destination ??
        rawRule.dest,
    );

    const status = normalizeStatusCode(
        rawRule.status ??
        rawRule.code ??
        rawRule.statusCode ??
        rawRule.responseCode ??
        rawRule.response_code ??
        rawRule.responseStatus ??
        rawRule.response_status,
    );

    if ( !file && !status ) return null;
    return { file: file ?? null, status: status ?? null };
};

const setRule = (config, key, rule) => {
    if ( ! rule ) return false;

    if ( key === 'default' ) {
        config.defaultRule = rule;
        return true;
    }

    if ( STATUS_CODE_REGEX.test(key) ) {
        config.exactRules[key] = rule;
        return true;
    }

    const classMatch = key.match(ERROR_CLASS_REGEX);
    if ( classMatch ) {
        config.classRules[`${classMatch[1]}xx`] = rule;
        return true;
    }

    return false;
};

const parseKeyedRules = (config, object) => {
    if ( !object || typeof object !== 'object' || Array.isArray(object) ) {
        return false;
    }

    let matched = false;
    for ( const [key, value] of Object.entries(object) ) {
        if (
            key !== 'default' &&
            !STATUS_CODE_REGEX.test(key) &&
            !ERROR_CLASS_REGEX.test(key)
        ) {
            continue;
        }
        matched = setRule(config, key.toLowerCase(), normalizeRule(value)) || matched;
    }
    return matched;
};

const parseCloudfrontRules = (config, value) => {
    if ( ! Array.isArray(value) ) return false;

    let matched = false;
    for ( const entry of value ) {
        if ( !entry || typeof entry !== 'object' ) continue;

        const errorCode = normalizeStatusCode(entry.ErrorCode ?? entry.errorCode ?? entry.error_code);
        if ( ! errorCode ) continue;

        const rule = normalizeRule({
            responsePagePath: entry.ResponsePagePath ?? entry.responsePagePath ?? entry.response_page_path,
            responseCode: entry.ResponseCode ?? entry.responseCode ?? entry.response_code,
        });
        if ( ! rule ) continue;

        config.exactRules[String(errorCode)] = rule;
        matched = true;
    }

    return matched;
};

const isCatchAllSource = source => {
    if ( typeof source !== 'string' ) return false;
    const s = source.trim();
    if ( s === '' ) return false;

    if ( [
        '/:path*',
        '/:match*',
        '/(.*)',
        '/(.*)?',
        '/.*',
        '^/(.*)$',
    ].includes(s) ) {
        return true;
    }

    if ( /^\/:\w+\*$/.test(s) ) return true;
    if ( /^\^?\/\(\.\*\)\$?$/.test(s) ) return true;
    return false;
};

const parseVercelRules = (config, value) => {
    if ( ! Array.isArray(value) ) return false;

    let matched = false;
    for ( const entry of value ) {
        if ( !entry || typeof entry !== 'object' ) continue;
        const source = entry.source ?? entry.src;
        if ( ! isCatchAllSource(source) ) continue;

        const rule = normalizeRule({
            destination: entry.destination ?? entry.dest,
            status: entry.status ?? 200,
        });
        if ( ! rule ) continue;

        config.exactRules['404'] = rule;
        matched = true;
    }

    return matched;
};

const parseJsonConfig = text => {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }

    const config = createEmptyConfig();
    let matched = false;

    matched = parseCloudfrontRules(config, parsed?.CustomErrorResponses ?? parsed?.customErrorResponses) || matched;

    matched = parseKeyedRules(config, parsed?.errors) || matched;
    matched = parseKeyedRules(config, parsed?.errorPages) || matched;
    matched = parseKeyedRules(config, parsed?.error_pages) || matched;

    matched = parseKeyedRules(config, parsed) || matched;

    const topLevelRule = normalizeRule(parsed);
    if ( topLevelRule ) {
        config.defaultRule = topLevelRule;
        matched = true;
    }

    matched = parseVercelRules(config, parsed?.rewrites) || matched;
    matched = parseVercelRules(config, parsed?.routes) || matched;

    return matched ? config : null;
};

const parseNginxStyleConfig = text => {
    const config = createEmptyConfig();
    let matched = false;

    const cleaned = text
        .replace(/\r\n/g, '\n')
        .replace(/#.*$/gm, '');

    const directives = cleaned.matchAll(/\berror_page\s+([^;]+);/gi);
    for ( const directive of directives ) {
        const args = directive[1];
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        if ( tokens.length < 2 ) continue;

        const uriToken = tokens.pop();
        const file = normalizeFilePath(uriToken);
        if ( ! file ) continue;

        let statusOverride = null;
        if ( tokens.length > 0 && tokens[tokens.length - 1].startsWith('=') ) {
            const overrideToken = tokens.pop();
            if ( overrideToken !== '=' ) {
                statusOverride = normalizeStatusCode(overrideToken.slice(1));
            }
        }

        const statusCodes = tokens
            .map(token => normalizeStatusCode(token))
            .filter(Boolean);

        if ( statusCodes.length === 0 ) continue;

        const rule = {
            file,
            status: statusOverride,
        };

        for ( const statusCode of statusCodes ) {
            config.exactRules[String(statusCode)] = rule;
            matched = true;
        }
    }

    return matched ? config : null;
};

const parseSiteErrorConfig = rawText => {
    if ( typeof rawText !== 'string' ) return null;
    const text = rawText.trim();
    if ( text === '' ) return null;

    const jsonConfig = parseJsonConfig(text);
    if ( jsonConfig ) return jsonConfig;

    return parseNginxStyleConfig(text);
};

const getSiteErrorRule = (config, statusCode) => {
    if ( !config || typeof config !== 'object' ) return null;

    const status = normalizeStatusCode(statusCode);
    if ( ! status ) return null;

    const exactRule = config.exactRules?.[String(status)];
    if ( exactRule ) return { ...exactRule };

    const classRule = config.classRules?.[`${Math.floor(status / 100)}xx`];
    if ( classRule ) return { ...classRule };

    if ( config.defaultRule ) return { ...config.defaultRule };
    return null;
};

module.exports = {
    parseSiteErrorConfig,
    getSiteErrorRule,
};
