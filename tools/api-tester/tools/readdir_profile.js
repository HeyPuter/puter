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

const dir = `/${conf.username}/readdir_test`

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

const epoch = Date.now();
const TIME_BEFORE_TEST = 20 * 1000; // 10 seconds

const NOOP = () => {};
let check = () => {
    if ( Date.now() - epoch >= TIME_BEFORE_TEST ) {
        console.log(
            `\x1B[36;1m !!! START THE TEST !!! \x1B[0m`
        );
        check = NOOP;
    }
};

const measure_readdir = async () => {
    const ts_start = Date.now();

    await axios.request({
        httpsAgent,
        method: 'post',
        url: getURL('readdir'),
        data: {
            path: dir,
        },
        headers: {
            'Authorization': `Bearer ${conf.token}`,
            'Content-Type': 'application/json'
        }
    })

    const ts_end = Date.now();

    const diff = ts_end - ts_start;

    await fs.promises.appendFile(
        `readdir_profile.txt`,
        `${Date.now()},${diff}\n`
    )

    check();

    await new Promise(rslv => {
        setTimeout(rslv, 5);
    });
}


const main = async () => {
    while (true) {
        await measure_readdir();
    }
}

main();
