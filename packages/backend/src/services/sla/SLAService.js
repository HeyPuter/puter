/*
 * Copyright (C) 2024 Puter Technologies Inc.
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
const BaseService = require("../BaseService");

/**
 * SLAService is responsible for getting the appropriate SLA for a given
 * driver or service endpoint, including limits with respect to the actor
 * and server-wide limits.
 */
class SLAService extends BaseService {
    async _construct () {
        // I'm not putting this in config for now until we have checks
        // for production configuration. - EAD
        this.hardcoded_limits = {
            system: {
                'driver:impl:public-helloworld:greet': {
                    rate_limit: {
                        max: 1000,
                        period: 30000,
                    },
                },
                'driver:impl:public-aws-textract:recognize': {
                    rate_limit: {
                        max: 10,
                        period: 30000,
                    },
                    monthly_limit: 80 * 1000,
                },
            },
            // app_default: {
            //     'driver:impl:public-aws-textract:recognize': {
            //         rate_limit: {
            //             max: 40,
            //             period: 30000,
            //         },
            //         monthly_limit: 1000,
            //     },
            //     'driver:impl:public-openai-chat-completion:complete': {
            //         rate_limit: {
            //             max: 30,
            //             period: 1000 * 60 * 60,
            //         },
            //         monthly_limit: 600,
            //     },
            //     'driver:impl:public-openai-image-generation:generate': {
            //         rate_limit: {
            //             max: 30,
            //             period: 1000 * 60 * 60,
            //         },
            //         monthly_limit: 10000,
            //     },
            // },
            user_unverified: {
                'driver:impl:public-aws-textract:recognize': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 20,
                },
                'driver:impl:public-openai-chat-completion:complete': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 100,
                },
                'driver:impl:public-openai-image-generation:generate': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 4,
                },
            },
            user_verified: {
                'driver:impl:public-aws-textract:recognize': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 100,
                },
                'driver:impl:public-openai-chat-completion:complete': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 1000,
                },
                'driver:impl:public-openai-image-generation:generate': {
                    rate_limit: {
                        max: 40,
                        period: 30000,
                    },
                    monthly_limit: 5,
                },
            }
        };
    }

    get (category, key) {
        return this.hardcoded_limits[category]?.[key];
    }
}

module.exports = {
    SLAService,
};
