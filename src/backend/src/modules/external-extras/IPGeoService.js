const APIError = require("../../api/APIError");
const BaseService = require("../../services/BaseService");

class IPGeoService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        col_interfaces.set('ip-geo', {
            description: 'IP Geolocation',
            methods: {
                ipgeo: {
                    description: 'Report geolocation information',
                    parameters: {
                        ip: {
                            type: 'string',
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
        ['ip-geo']: {
            async ipgeo ({ ip }) {
                // doing this makes vscode recognize what's being required
                const require = this.require;

                const axios = require('axios');
                const querystring = require('querystring');
                
                const qstr = querystring.stringify({
                    // Yep, API key reall does go in the query string.
                    // This is what the docs say to do.
                    apiKey: this.config.apiKey,
                    
                    ip,
                });
                
                {
                    const microcents_per_request = this.config.microcents_per_request
                        ?? 7000;
                    const svc_cost = this.services.get('cost');
                    const usageAllowed = await svc_cost.get_funding_allowed({
                        minimum: microcents_per_request,
                    });
                    if ( ! usageAllowed ) {
                        throw APIError.create('insufficient_funds');
                    }
                    await svc_cost.record_cost({ cost: microcents_per_request });
                }

                
                const resp = await axios.request({
                    method: 'GET',
                    url:  'https://api.ipgeolocation.io/ipgeo?' + qstr,
                });
                
                return resp.data;
            }
        }
    }
}

module.exports = {
    IPGeoService,
};
