const log_http_error = e => {
    console.log('\x1B[31;1m' + e.message + '\x1B[0m');

    console.log('HTTP Method: ', e.config.method.toUpperCase());
    console.log('URL: ', e.config.url);

    if (e.config.params) {
        console.log('URL Parameters: ', e.config.params);
    }

    if (e.config.method.toLowerCase() === 'post' && e.config.data) {
        console.log('Post body: ', e.config.data);
    }

    console.log('Request Headers: ', JSON.stringify(e.config.headers, null, 2));

    if (e.response) {
        console.log('Response Status: ', e.response.status);
        console.log('Response Headers: ', JSON.stringify(e.response.headers, null, 2));
        console.log('Response body: ', e.response.data);
    }

    console.log('\x1B[31;1m' + e.message + '\x1B[0m');
};

const log_error = e => {
    if ( e.request ) {
        log_http_error(e);
        return;
    }

    console.error(e);
};

module.exports = log_error;