const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");

class NewsDataService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('newsdata', {
            description: 'NewsData.io',
            methods: {
                newsdata: {
                    description: 'Report geolocation information',
                    parameters: {
                        '*': {
                            type: 'json',
                        },
                    },
                    result: {
                        type: 'json'
                    },
                },
            }
        });
    }
    
    static IMPLEMENTS = {
        newsdata: {
            async newsdata (parameters) {
                // doing this makes vscode recognize what's being required
                const require = this.require;

                const axios = require('axios');
                const querystring = require('querystring');
                
                const qstr = querystring.stringify({
                    ...parameters,

                    // Yep, API key reall does go in the query string.
                    // This is what the docs say to do.
                    apikey: this.config.apiKey,
                    size: 10,
                });
                
                const resp = await axios.request({
                    method: 'GET',
                    url: 'https://newsdata.io/api/1/latest?' + qstr,
                });
                
                return resp.data;
            }
        }
    }
}

module.exports = {
    NewsDataService,
};
