const axios = require('axios');

class Judge0Client {
    constructor (options = {}) {
        Object.assign(this, {
            baseURL: 'https://judge0-ce.p.sulu.sh',
            token: '',
        }, options);
    }

    async about () {
        return await this.get_('/about');
    }

    async get_ (path) {
        if ( ! path.startsWith('/') ) {
            path = `/${path}`;
        }
        console.log('how is this url invalid??', `${this.baseURL}${path}`);
        const resp = await axios.request({
            method: 'GET',
            url: `${this.baseURL}${path}`,
            headers: {
                Authorization: `Bearer ${this.token}`,
            },
        });

        return resp.data;
    }
}

module.exports = { Judge0Client };