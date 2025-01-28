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

    async create_submission ({ lang_id, code }) {
        return await this.post_('/submissions', {
            language_id: lang_id,
            source_code: code,
        });
    }

    async get_submission (id) {
        return await this.get_(`/submissions/${id}`);
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

    async post_ (path, data) {
        if ( ! path.startsWith('/') ) {
            path = `/${path}`;
        }

        const resp = await axios.request({
            method: 'POST',
            url: `${this.baseURL}${path}`,
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            data,
        });

        return resp.data;
    }
}

module.exports = { Judge0Client };