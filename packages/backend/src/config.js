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
"use strict"
const deep_proto_merge = require('./config/deep_proto_merge');
// const reserved_words = require('./config/reserved_words');

let config = {};

// Static defaults
config.servers = [];

config.max_file_size = 100_000_000_000,
config.max_thumb_size = 1_000,
config.max_fsentry_name_length = 767,

config.username_regex = /^\w{1,}$/;
config.username_max_length = 45;
config.subdomain_regex = /^[a-zA-Z0-9-_-]+$/;
config.subdomain_max_length = 60;
config.app_name_regex = /^[a-zA-Z0-9-_-]+$/;
config.app_name_max_length = 60;
config.app_title_max_length = 60;
config.min_pass_length = 6;

config.strict_email_verification_required = false,
config.require_email_verification_to_publish_website = false,

config.kv_max_key_size = 1024,
config.kv_max_value_size = 400 * 1024,

config.monitor = {
    metricsInterval: 60000,
    windowSize: 30,
};

config.max_subdomains_per_user = 2000;
config.storage_capacity = 1*1024*1024*1024;
config.static_hosting_domain = '-static.puter.local';

// Storage limiting is set to false by default
// Storage available on the mountpoint/drive puter is running is the storage available
config.is_storage_limited = false;
config.available_device_storage = null;

config.thumb_width = 80;
config.thumb_height = 80;
config.app_max_icon_size = 5*1024*1024;

config.defaultjs_asset_path = '../../';

// config.origin = config.protocol + '://' + config.domain;
// config.api_base_url = config.protocol + '://api.' + config.domain;
// config.social_card = `${config.origin}/assets/img/screenshot.png`;
config.short_description = `Puter is a privacy-first personal cloud that houses all your files, apps, and games in one private and secure place, accessible from anywhere at any time.`;
config.title = 'Puter';
config.company = 'Puter Technologies Inc.';

config.puter_hosted_data = {
    puter_versions: 'https://version.puter.site/puter_versions.json',
};

{
    const path_ = require('path');
    config.assets = {
        gui: path_.join(__dirname, '../../..'),
        gui_profile: 'development',
    };
}

// words that cannot be used by others as subdomains or app names
// config.reserved_words = reserved_words;
config.reserved_words = [];

// set default S3 settings for this server, if any
if (config.server_id) {
	// see if this server has a specific bucket
	for (let index = 0; index < config.servers.length; index++) {
		if (config.servers[index].id === config.server_id && config.servers[index].s3_bucket){
			config.s3_bucket = config.servers[index].s3_bucket;
            config.s3_region = config.servers[index].region;
        }
	}
}

config.contact_email = 'hey@' + config.domain;

// TODO: default value will be changed to false in a future release;
//       details to follow in a future announcement.
config.legacy_token_migrate = true;

module.exports = config;

// NEW_CONFIG_LOADING

const computed_defaults = {
    pub_port: config => config.http_port,
    origin: config => config.protocol + '://' + config.domain +
        (config.pub_port !== 80 && config.pub_port !== 443 ? ':' + config.pub_port : ''),
    api_base_url: config => config.experimental_no_subdomain
        ? config.origin
        : config.protocol + '://api.' + config.domain +
        (config.pub_port !== 80 && config.pub_port !== 443 ? ':' + config.pub_port : ''),
    social_card: config => `${config.origin}/assets/img/screenshot.png`,
};

// We're going to export a config object that's decorated
// with additional behavior
let config_to_export;

// We have a pointer to some config object which
// load_config() may replace
const config_pointer = {};
{
    config_pointer.__proto__ = config;
    config_to_export = config_pointer;
}


// We have some methods that can be called on `config`
{
    // Add configuration values with precedence over the current config
    const load_config = o => {
        let replacement_config = {
            ...o,
        };
        // replacement_config.__proto__ = config_pointer.__proto__;
        replacement_config = deep_proto_merge(replacement_config, config_pointer.__proto__, {
            preserve_flag: true,
        })
        config_pointer.__proto__ = replacement_config;
    };

    const config_api = { load_config };
    config_api.__proto__ = config_to_export;
    config_to_export = config_api;
}

// We have some values with computed defaults
{
    const get_implied = (target, prop) => {
        if (prop in computed_defaults) {
            return computed_defaults[prop](target);
        }
        return undefined;
    };
    config_to_export = new Proxy(config_to_export, {
        get: (target, prop, receiver) => {
            if (prop in target) {
                return target[prop];
            } else {
                // console.log('implied', prop,
                //     'to', get_implied(config_to_export, prop));
                return get_implied(config_to_export, prop);
            }
        }
    })
}

// We'd like to store values changed at runtime separately
// for easier runtime debugging
{
    const config_runtime_values = {
        $: 'runtime-values'
    };
    config_runtime_values.__proto__ = config_to_export;
    config_to_export = config_runtime_values

    // These can be difficult to find and cause painful
    // confusing issues, so we log any time this happens
    config_to_export = new Proxy(config_to_export, {
        set: (target, prop, value, receiver) => {
            console.log(
                '\x1B[36;1mCONFIGURATION MUTATED AT RUNTIME\x1B[0m',
                prop, 'to', value
            );
            // console.log(new Error('stack trace to find configuration mutation'));
            target[prop] = value;
            return true;
        }
    })
}

module.exports = config_to_export;
