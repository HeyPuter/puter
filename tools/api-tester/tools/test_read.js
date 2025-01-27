const axios = require('axios');
const YAML = require('yaml');

const https = require('node:https');
const { parseArgs } = require('node:util');
const url = require('node:url');

const path_ = require('path');
const fs = require('fs');

let config;

try {
    ({ values: {
        config,
    }, positionals: [id] } = parseArgs({
        options: {
            config: {
                type: 'string',
            },
        },
        allowPositionals: true,
    }));
} catch (e) {
    if ( args.length < 1 ) {
        console.error(
            'Usage: readdir_profile [OPTIONS]\n' +
            '\n' +
            'Options:\n' +
            '  --config=<path>  (required)  Path to configuration file\n' +
            ''
        );
        process.exit(1);
    }
}

const conf = YAML.parse(fs.readFileSync(config).toString());

const entry = `/${conf.username}/read_test.txt`;

// process.on('SIGINT', async () => {
//     process.exit(0);
// });

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
})
const getURL = (...path) => {
    const apiURL = new url.URL(conf.url);
    apiURL.pathname = path_.posix.join(
        apiURL.pathname,
        ...path
    );
    return apiURL.href;
};

const main = async () => {
    const resp = await axios.request({
        httpsAgent,
        method: 'get',
        url: getURL('read'),
        params: {
            file: entry,
        },
        headers: {
            'Authorization': `Bearer ${conf.token}`,
        }
    })
    console.log(resp.data);
}

main();

