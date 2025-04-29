const BaseService = require('../../services/BaseService');
const { Context } = require('../../util/context');

class WeatherService extends BaseService {
    async ['__on_driver.register.interfaces'] () {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');
        
        const common = {
            default_parameter: 'q',
            parameters: {
                '*': {
                    type: 'json',
                },
            },
            result: {
                type: 'json'
            },
        };
        
        col_interfaces.set('weather', {
            description: 'weatherapi.com',
            methods: {
                weather: {
                    description: 'Report current weather in the specified location',
                    ...common,
                },
                forecast: {
                    description: 'Report the weather forecast for the specified location',
                    ...common,
                },
            }
        });
    }
    async _init () {
        this.baseURL = 'https://api.weatherapi.com/v1';
    }
    static IMPLEMENTS = {
        weather: {
            // We call this "weather" instead of "current" so that it can be
            // the default method for the weather driver.
            async weather (parameters) {
                return await this.general('current.json', parameters);
            },
            async forecast (parameters) {
                // Okay this is kinda dumb but the default behavior for forecast
                // is that it forecasts 1 day - the current day. I'm going to make
                // the default 5 days here because I think that's what most people
                // will expect.
                
                if ( parameters.days === undefined ) {
                    parameters.days = 5;
                }
                
                return await this.general('forecast.json', parameters);
            }
        }
    }

    async general (component, parameters) {
        const require = this.require;

        const axios = require('axios');
        const querystring = require('querystring');
        
        if ( ! parameters.q ) {
            const requester = Context.get('requester');
            parameters.q = requester.ip_user ??
                '-77.6776746,165.2019492'; // McMurdo Station, Antarctica
        }
        
        const qstr = querystring.stringify({
            ...parameters,
            key: this.config.apiKey,
        });
        
        const req_options = {
            method: 'GET',
            url: this.baseURL + `/${component}?` + qstr,
        };
        
        console.log('debug the request', req_options);

        const resp = await axios.request(req_options);
        
        return resp.data;
    }
}

module.exports = {
    WeatherService,
};
