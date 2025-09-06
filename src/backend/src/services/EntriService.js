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
let  parseDomain ;
const { Eq } = require("../om/query/query");
const { Endpoint } = require("../util/expressutil");
const { IncomingMessage } = require("node:http");
const { Context } = require("../util/context");
const { createHash } = require('crypto');
const { NULL } = require("../om/proptypes/__all__");
const APIError = require("../api/APIError");

// async function generateJWT(applicationId, secret, domain, ) {

//     return (await response.json()).auth_token;
// }

class EntriService extends BaseService {
    _init() {

    }

    async _construct() {
        parseDomain = (await import('parse-domain')).parseDomain;
    }

    ['__on_install.routes'](_, { app }) {
        Endpoint({
            route: '/entri/webhook',
            methods: ['POST', "GET"],
            /**
             * 
             * @param {IncomingMessage} req 
             * @param {*} res 
             */
            handler: async (req, res) => {
                if (createHash('sha256').update(req.body.id + this.config.secret).digest('hex') !== req.headers["entri-signature"]) {
                    res.status(401).send("Lol");
                    return;
                }
                if (!req.body.data.records_propagated) {
                    return;
                }
                let rootDomain = false;
                if (req.body.data.records_propagated[0].type === "A") {
                    rootDomain = true;
                }

                let realDomain = (rootDomain ? "" : (req.body.subdomain + "."))  + req.body.domain;
                const svc_su = this.services.get("su");

                const es_subdomain = this.services.get('es:subdomain');

                await svc_su.sudo(async () => {
                    const rows = (await es_subdomain.select({ predicate: new Eq({ key: "domain", value: "in-progress:" + realDomain }) }));
                    for (const row of rows) {
                        const entity = await Entity.create({ om: es_subdomain.om }, {
                            uid: row.values_.uid,
                            domain: realDomain
                        });
                        await es_subdomain.upsert(entity);

                    }
                    return true;
                });



                res.end("ok")
            },
        }).attach(app);

        const svc_web = this.services.get('web-server');
        svc_web.allow_undefined_origin('/entri/webhook', '/entri/webhook');
    }

    static IMPLEMENTS = {
        ['entri']: {
            async getConfig({ domain, userHostedSite }) {
                const es_subdomain = this.services.get('es:subdomain');
                const svc_su = this.services.get("su");

                let rootDomain = (parseDomain(domain)).icann.subDomains.length === 0;

                const exists = await svc_su.sudo(async ()=>{
                    const row = (await es_subdomain.select({ predicate: new Eq({ key: "domain", value: domain }) }))[0] || (await es_subdomain.select({ predicate: new Eq({ key: "domain", value: "in-progress:" + domain }) }))[0];
                    if (!!row && row.values_.subdomain === userHostedSite.replace(".puter.site", "")) {
                        return false;
                    }
                    return !!row;
                });

                if (exists) {
                    throw APIError.create("already_in_use", null, {what: "domain", value: domain});
                }


                const dnsRecords = rootDomain ? [{
                    type: "A",
                    host: "@",
                    value: "{ENTRI_SERVERS}", //This will be automatically replaced for the Entri servers IPs
                    ttl: 300,
                    applicationUrl: userHostedSite,
                }] : [{
                    type: "CNAME",
                    value: "power.goentri.com", // `{CNAME_TARGET}` will NOT automatically use the CNAME target as implied by the documentation
                    host: "{SUBDOMAIN}", // This will use the user inputted subdomain. If hostRequired is set to true, then this will default to "www"
                    ttl: 300,
                    applicationUrl: userHostedSite
                }];

                const response = await fetch('https://api.goentri.com/token', {
                    method: 'POST',
                    body: JSON.stringify({
                        applicationId: this.config.applicationId,
                        secret: this.config.secret,
                        domain,
                        // dnsRecords 
                    })
                });

                const row = (await es_subdomain.select({ predicate: new Eq({ key: "subdomain", value: userHostedSite.replace(".puter.site", "") }) }))[0];
                const entity = await Entity.create({ om: es_subdomain.om }, {
                    uid: row.values_.uid,
                    domain: "in-progress:" + domain
                });

                await es_subdomain.upsert(entity);

                return { 
                    token: (await response.json()).auth_token, 
                    applicationId: this.config.applicationId, 
                    power: true, 
                    dnsRecords, 
                    prefilledDomain: domain,
                    hostRequired: false
                }


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
            async deleteMapping({domain}) {
                if (domain.startsWith("in-progress"))
                    throw APIError.create('field_invalid', null, {key: "domain", expected: 'valid domain'});

                /** @type {import("../om/entitystorage/SubdomainES")} */
                const es_subdomain = this.services.get('es:subdomain');

                const row = (await es_subdomain.select({ predicate: new Eq({ key: "domain", value: domain }) }))[0] || (await es_subdomain.select({ predicate: new Eq({ key: "domain", value: "in-progress:" + domain }) }))[0];
                if (!row) {
                    throw APIError.create('forbidden', null, {});
                }

                let inProgress = false;
                if (row.values_.domain.startsWith("in-progress:")) {                    
                    inProgress = true;
                }

                // Get token from Entri
                const { auth_token } = await (fetch('https://api.goentri.com/token', {
                    method: 'POST',
                    body: JSON.stringify({
                        applicationId: this.config.applicationId,
                        secret: this.config.secret,
                    })
                }).then(r => r.json()));
                
                const entity = await Entity.create({ om: es_subdomain.om }, {
                    uid: row.values_.uid,
                    domain: NULL
                });
                await es_subdomain.upsert(entity);
                const errors = []
                // Even if the domain is in progress, still send the delete incase it's just propgation taking a while
                const deleteRequest = await (fetch('https://api.goentri.com/power', {
                    method: 'DELETE',
                    headers: {
                        applicationId: this.config.applicationId,
                        "Authorization": "Bearer " + auth_token
                    },
                    body: JSON.stringify({ domain })
                }));
                if (deleteRequest.status !== 200) {
                    errors.push(await deleteRequest.text())
                }

                return {ok: true, errors};

            },
            async fullyRegistered({ domain, userHostedSite }) {
                const es_subdomain = this.services.get('es:subdomain');
                const row = (await es_subdomain.select({ predicate: new Eq({ key: "subdomain", value: userHostedSite.replace(".puter.site", "") }) }))[0];


            }
        }
    }
    async ['__on_driver.register.interfaces']() {
        const svc_registry = this.services.get('registry');
        const col_interfaces = svc_registry.get('interfaces');

        col_interfaces.set('entri', {
            description: 'Execute code with various languages.',
            methods: {
                getConfig: {
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
                }, 
                deleteMapping: {
                    description: 'delete domain mapping from entri',
                    parameters: {
                        domain: {
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
