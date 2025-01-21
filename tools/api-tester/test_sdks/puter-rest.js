const axios = require('axios');

class PuterRestTestSDK {
    constructor (config) {
        this.config = config;
    }
    async create() {
        const conf = this.config;
        const axiosInstance = axios.create({
            httpsAgent: new https.Agent({
                rejectUnauthorized: false,
            }),
            baseURL: conf.url,
            headers: {
                'Authorization': `Bearer ${conf.token}`, // common headers
                //... other headers
            }
        });
        return axiosInstance;
    }
}

module.exports = ({ config }) => new PuterRestTestSDK(config);
