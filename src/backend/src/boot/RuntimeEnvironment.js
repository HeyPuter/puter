/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const { AdvancedBase } = require("@heyputer/putility");
const { quot } = require('@heyputer/putility').libs.string;
const { TechnicalError } = require("../errors/TechnicalError");
const { print_error_help } = require("../errors/error_help_details");
const default_config = require("./default_config");
const config = require("../config");
const { ConfigLoader } = require("../config/ConfigLoader");

// highlights a string
const hl = s => `\x1b[33;1m${s}\x1b[0m`;

// Save the original working directory
const original_cwd = process.cwd();

// === [ Puter Runtime Environment ] ===
// This file contains the RuntimeEnvironment class which is
// responsible for locating the configuration and runtime
// directories for the Puter Kernel.

// Depending on which path we're checking for configuration
// or runtime from config_paths, there will be different
// requirements. These are all possible requirements.
//
// Each check may result in the following:
// - false: this is not the desired path; skip it
// - true:  this is the desired path, and it's valid
// - throw: this is the desired path, but it's invalid
const path_checks = ({ logger }) => ({ fs, path_ }) => ({
    require_if_not_undefined: ({ path }) => {
        if ( path == undefined ) return false;

        const exists = fs.existsSync(path);
        if ( !exists ) {
            throw new Error(`Path does not exist: ${path}`);
        }

        return true;
    },
    skip_if_not_exists: ({ path }) => {
        const exists = fs.existsSync(path);
        return exists;
    },
    skip_if_not_in_repo: ({ path }) => {
        const exists = fs.existsSync(path_.join(path, '../../.is_puter_repository'));
        return exists;
    },
    require_read_permission: ({ path }) => {
        try {
            fs.readdirSync(path);
        } catch (e) {
            throw new Error(`Cannot readdir on path: ${path}`);
        }
        return true;
    },
    require_write_permission: ({ path }) => {
        try {
            fs.writeFileSync(path_.join(path, '.tmp_test_write_permission'), 'test');
            fs.unlinkSync(path_.join(path, '.tmp_test_write_permission'));
        } catch (e) {
            throw new Error(`Cannot write to path: ${path}`);
        }
        return true;
    },
    contains_config_file: ({ path }) => {
        const valid_config_names = [
            'config.json',
            'config.json5',
        ];
        for ( const name of valid_config_names ) {
            const exists = fs.existsSync(path_.join(path, name));
            if ( exists ) {
                return true;
            }
        }
        throw new Error(`No valid config file found in path: ${path}`);
    },
    env_not_set: name => () => {
        if ( process.env[name] ) return false;
        return true;
    }
});

// Configuration paths in order of precedence.
// We will load configuration from the first path that's suitable.
const config_paths = ({ path_checks }) => ({ path_ }) => [
    {
        label: '$CONFIG_PATH',
        get path () { return process.env.CONFIG_PATH },
        checks: [
            path_checks.require_if_not_undefined,
        ],
    },
    {
        path: '/etc/puter',
        checks: [ path_checks.skip_if_not_exists ],
    },
    {
        get path () {
            return path_.join(original_cwd, 'volatile/config');
        },
        checks: [ path_checks.skip_if_not_in_repo ],
    },
    {
        get path () {
            return path_.join(original_cwd, 'config');
        },
        checks: [ path_checks.skip_if_not_exists ],
    },
];

const valid_config_names = [
    'config.json',
    'config.json5',
];

// Suitable working directories in order of precedence.
// We will `process.chdir` to the first path that's suitable.
const runtime_paths = ({ path_checks }) => ({ path_ }) => [
    {
        label: '$RUNTIME_PATH',
        get path () { return process.env.RUNTIME_PATH },
        checks: [
            path_checks.require_if_not_undefined,
        ],
    },
    {
        path: '/var/puter',
        checks: [
            path_checks.skip_if_not_exists,
            path_checks.env_not_set('NO_VAR_RUNTIME'),
        ],
    },
    {
        get path () {
            return path_.join(original_cwd, 'volatile/runtime');
        },
        checks: [ path_checks.skip_if_not_in_repo ],
    },
    {
        get path () {
            return path_.join(original_cwd, 'runtime');
        },
        checks: [ path_checks.skip_if_not_exists ],
    },
];

// Suitable mod paths in order of precedence.
const mod_paths = ({ path_checks, entry_path }) => ({ path_ }) => [
    {
        label: '$MOD_PATH',
        get path () { return process.env.MOD_PATH },
        checks: [
            path_checks.require_if_not_undefined,
        ],
    },
    {
        path: '/var/puter/mods',
        checks: [
            path_checks.skip_if_not_exists,
            path_checks.env_not_set('NO_VAR_MODS'),
        ],
    },
    {
        get path () {
            return path_.join(path_.dirname(
                entry_path || require.main.filename), '../mods');
        },
        checks: [ path_checks.skip_if_not_exists ],
    },
];

class RuntimeEnvironment extends AdvancedBase {
    static MODULES = {
        fs: require('node:fs'),
        path_: require('node:path'),
        crypto: require('node:crypto'),
        format: require('string-template'),
    }

    constructor ({ logger, entry_path, boot_parameters }) {
        super();
        this.logger = logger;
        this.entry_path = entry_path;
        this.boot_parameters = boot_parameters;
        this.path_checks = path_checks(this)(this.modules);
        this.config_paths = config_paths(this)(this.modules);
        this.runtime_paths = runtime_paths(this)(this.modules);
        this.mod_paths = mod_paths(this)(this.modules);
    }

    init () {
        try {
            return this.init_();
        } catch (e) {
            this.logger.error(e);
            print_error_help(e);
            process.exit(1);
        }
    }

    init_ () {
        // This variable, called "environment", will be passed back to Kernel
        // with some helpful values. A partial-population of this object later
        // in this function will be used when evaluating configured paths.
        const environment = {};
        environment.source = this.modules.path_.dirname(
            this.entry_path || require.main.filename);

        const config_path_entry = this.get_first_suitable_path_(
            { pathFor: 'configuration' },
            this.config_paths,
            [
                this.path_checks.require_read_permission,
                // this.path_checks.contains_config_file,
            ]
        );

        // Note: there used to be a 'mods_path_entry' here too
        //       but it was never used
        const pwd_path_entry = this.get_first_suitable_path_(
            { pathFor: 'working directory' },
            this.runtime_paths,
            [ this.path_checks.require_write_permission ]
        );

        process.chdir(pwd_path_entry.path);

        // Check for a valid config file in the config path
        let using_config;
        for ( const name of valid_config_names ) {
            const exists = this.modules.fs.existsSync(
                this.modules.path_.join(config_path_entry.path, name)
            );
            if ( exists ) {
                using_config = name;
                break;
            }
        }

        const owrite_config = this.boot_parameters.args.overwriteConfig;

        const { fs, path_, crypto } = this.modules;
        if ( !using_config || owrite_config ) {
            const generated_values = {};
            generated_values.cookie_name = crypto.randomUUID();
            generated_values.jwt_secret = crypto.randomUUID();
            generated_values.url_signature_secret = crypto.randomUUID();
            generated_values.private_uid_secret = crypto.randomBytes(24).toString('hex');
            generated_values.private_uid_namespace = crypto.randomUUID();
            if ( using_config ) {
                this.logger.info(
                    `Overwriting ${quot(using_config)} because ` +
                    `${hl('--overwrite-config')} is set`
                );
                // make backup
                fs.copyFileSync(
                    path_.join(config_path_entry.path, using_config),
                    path_.join(config_path_entry.path, using_config + '.bak'),
                );
                // preserve generated values
                {
                    const config_raw = fs.readFileSync(
                        path_.join(config_path_entry.path, using_config),
                        'utf8',
                    );
                    const config_values = JSON.parse(config_raw);
                    for ( const k in generated_values ) {
                        if ( config_values[k] ) {
                            generated_values[k] = config_values[k];
                        }
                    }
                }
            }
            const generated_config = {
                ...default_config,
                ...generated_values,
            };
            generated_config[""] = null; // for trailing comma
            fs.writeFileSync(
                path_.join(config_path_entry.path, 'config.json'),
                JSON.stringify(generated_config, null, 4) + '\n',
            );
            using_config = 'config.json';
        }

        let config_to_load = 'config.json';
        if ( process.env.PUTER_CONFIG_PROFILE ) {
            this.logger.info(
                hl('PROFILE') + ' ' +
                quot(process.env.PUTER_CONFIG_PROFILE) + ' ' +
                `because $PUTER_CONFIG_PROFILE is set`
            );
            config_to_load = `${process.env.PUTER_CONFIG_PROFILE}.json`
            const exists = fs.existsSync(
                path_.join(config_path_entry.path, config_to_load)
            );
            if ( ! exists ) {
                fs.writeFileSync(
                    path_.join(config_path_entry.path, config_to_load),
                    JSON.stringify({
                        config_name: process.env.PUTER_CONFIG_PROFILE,
                        $imports: ['config.json'],
                    }, null, 4) + '\n',
                );
            }
        }

        const loader = new ConfigLoader(this.logger, config_path_entry.path, config);
        loader.enable(config_to_load);

        if ( ! config.config_name ) {
            throw new Error('config_name is required');
        }
        this.logger.info(hl(`config name`) + ` ${quot(config.config_name)}`);
        // console.log(config.services);
        // console.log(Object.keys(config.services));
        // console.log({ ...config.services });

        const mod_paths = [];
        environment.mod_paths = mod_paths;

        // Trying this as a default for now...
        if ( ! config.mod_directories ) {
            config.mod_directories = [
                '{source}/../mods/mods_enabled',
                '{source}/../extensions',
            ];
        }

        // If configured, add a user-specified mod path
        if ( config.mod_directories ) {
            for ( const dir of config.mod_directories ) {
                const mods_directory = this.modules.format(
                    dir, environment,
                );
                mod_paths.push(mods_directory);
            }
        }

        return environment;
    }

    get_first_suitable_path_ (meta, paths, last_checks) {
        iter_paths:
        for ( const entry of paths ) {
            const checks = [...(entry.checks ?? []), ...last_checks];
            this.logger.info(
                `Checking path ${quot(entry.label ?? entry.path)} for ${meta.pathFor}...`
            );
            for ( const check of checks ) {
                this.logger.info(
                    `-> doing ${quot(check.name)} on path ${quot(entry.path)}...`
                );
                const result = check(entry);
                if ( result === false ) {
                    this.logger.info(
                        `-> ${quot(check.name)} doesn't like this path`
                    );
                    continue iter_paths;
                }
            }

            this.logger.info(
                `${hl('USING')} ${quot(entry.path)} for ${meta.pathFor}.`
            )

            return entry;
        }

        if ( meta.optional ) return;
        throw new TechnicalError(`No suitable path found for ${meta.pathFor}.`);
    }
}

module.exports = {
    RuntimeEnvironment,
};