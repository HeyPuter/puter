/*
 * Copyright (C) 2025-present Puter Technologies Inc.
 * 
 * This file is part of Puter.
 * 
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * 
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * 
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

const BaseService = require("./BaseService");
const fs = require("node:fs");

const { Entity } = require("../om/entitystorage/Entity");;
// const { get_app, subdomain } = require("../helpers");
const { parseDomain } = require("parse-domain")

// async function generateJWT(applicationId, secret, domain, ) {

//     return (await response.json()).auth_token;
// }

class EntriService extends BaseService {
    _init() {

    }
    static IMPLEMENTS = {
        ['entri']: {
            async getJWT ({ domain, userHostedSite}) {
                const es_subdomain = this.services.get('es:subdomain');
                let rootDomain = (parseDomain(domain)).icann.subDomains.length === 0;
                const response = await fetch('https://api.goentri.com/token', {
                    method: 'POST',
                    body: JSON.stringify({
                        applicationId: this.config.applicationId,
                        secret: this.config.secret,
                        domain,
                        dnsRecords: rootDomain ? [
                            {
                                type: "A",
                                host: "@",
                                value: "{ENTRI_SERVERS}", //This will be automatically replaced for the Entri servers IPs
                                ttl: 300,
                                applicationUrl: userHostedSite,
                            }
                        ] : [
                            {
                                type: "CNAME",
                                value: "{CNAME_TARGET}", // `{CNAME_TARGET}` will automatically use the CNAME target entered in the dashboard
                                host: "{SUBDOMAIN}", // This will use the user inputted subdomain. If hostRequired is set to true, then this will default to "www"
                                ttl: 300,
                                applicationUrl: userHostedSite
                            }
                        ]
                    }),
                });
                const entity = await Entity.create({ om: es_subdomain.om }, {
                    subdomain: userHostedSite.replace(".puter.site", ""),
                    domain: "in-progress:" + domain
                });

                await es_subdomain.upsert(entity);
                return { auth_token: (await response.json()).auth_token, rootDomain}

                
                // let rootDomain = (parseDomain(domain)).icann.subDomains.length === 0;
                
                // const response = await fetch('https://api.goentri.com/power?' + new URLSearchParams({
                //     domain,
                //     rootDomain
                // }), {
                //     method: 'GET',
                //     headers: {
                //         'Content-Type': 'application/json',
                //         'Authorization': jwtForVerification,
                //         'applicationId': this.config.applicationId
                //     }
                // });

                // const data = await response.json();
                // if (!data.eligible) {
                //     throw new APIError(); // figure this out later
                // }
                

                
            },
        }
    }
    async ['__on_driver.register.interfaces']() {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');

        col_interfaces.set('entri', {
            description: 'Execute code with various languages.',
            methods: {
                getJWT: {
                    description: 'get JWT for entri',
                    parameters: {
                        domain: {
                            type: "string",
                            optional: false
                        },
                        userHostedSite: {
                            type: "string",
                            optional: false
                        }
                    },
                    result: { type: 'json' }
                }
            }
        });
    }
}

module.exports = {
    EntriService,
};
