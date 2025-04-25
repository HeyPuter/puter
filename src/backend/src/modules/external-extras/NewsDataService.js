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
                    default_parameter: 'q',
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
                const cost_per_article =
                    this.config.cost_per_article ?? 13000;
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
                
                const amount_articles = resp.data.results.length;

                {
                    const cost = amount_articles * cost_per_article;
                    const svc_cost = this.services.get('cost');
                    const usageAllowed = await svc_cost.get_funding_allowed({
                        minimum: cost,
                    });
                    if ( ! usageAllowed ) {
                        throw APIError.create('insufficient_funds');
                    }
                    await svc_cost.record_cost({ cost });
                }
                
                return resp.data;
            }
        }
    }
}

module.exports = {
    NewsDataService,
};
