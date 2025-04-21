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
