const axios = require('axios');

module.exports = {
    name: 'auth',
    do: async t => {
        await t.case('signup', async () => {
            const endpoint = 'signup';
            const params = {
                username: 'test',
                password: 'test',
            };
            const res = await axios.request({
                httpsAgent: this.httpsAgent,
                method: 'post',
                url: t.getURL(endpoint),
                data: params,
                headers: {
                    ...t.headers_,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                }
            })
            console.log('res.status:', res?.status);
            console.log('res.statusText:', res?.statusText);
            console.log('res.data:', res?.data);
        });
    },
};