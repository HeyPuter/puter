/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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

// METADATA // {"ai-commented":{"service":"claude"}}
const { can } = require("../util/langutil");
const BaseService = require("./BaseService");


/**
* CleanEmailService - A service class for cleaning and validating email addresses
* Handles email normalization by applying provider-specific rules (e.g. Gmail's dot-insensitivity),
* manages subaddressing (plus addressing), and validates against blocked domains.
* Extends BaseService to integrate with the application's service infrastructure.
* @extends BaseService
*/
class CleanEmailService extends BaseService {
    static NAMED_RULES = {
        // For some providers, dots don't matter
        dots_dont_matter: {
            name: 'dots_dont_matter',
            description: 'Dots don\'t matter',
            rule: ({ eml }) => {
                eml.local = eml.local.replace(/\./g, '');
            },
        },
        remove_subaddressing: {
            name: 'remove_subaddressing',
            description: 'Remove subaddressing',
            rule: ({ eml }) => {
                eml.local = eml.local.split('+')[0];
            },
        },
    };
    static PROVIDERS = {
        gmail: {
            name: 'gmail',
            description: 'Gmail',
            rules: ['dots_dont_matter'],
        },
        icloud: {
            name: 'icloud',
            description: 'iCloud',
            rules: ['dots_dont_matter'],
        },
        yahoo: {
            name: 'yahoo',
            description: 'Yahoo',
            // Yahoo doesn't allow subaddressing, which would be a non-issue,
            // except Yahoo allows '+' symbols in the primary email address.
            rmrules: ['remove_subaddressing'],
        },
    };
    // Service providers may have multiple subdomains a user can choose
    static DOMAIN_TO_PROVIDER = {
        'gmail.com': 'gmail',
        'yahoo.com': 'yahoo',
        'yahoo.co.uk': 'yahoo',
        'yahoo.ca': 'yahoo',
        'yahoo.com.au': 'yahoo',
        'icloud.com': 'icloud',
        'me.com': 'icloud',
        'mac.com': 'icloud',
    };
    // Service providers may allow the same primary email address to be
    // used with different domains
    static DOMAIN_NONDISTINCT = {
        'googlemail.com': 'gmail.com',
    }
    /**
    * Maps non-distinct email domains to their canonical equivalents.
    * For example, 'googlemail.com' is mapped to 'gmail.com' since they
    * represent the same email service.
    * @type {Object.<string, string>}
    */
    _construct () {
        this.named_rules = this.constructor.NAMED_RULES;
        this.providers = this.constructor.PROVIDERS;
        this.domain_to_provider = this.constructor.DOMAIN_TO_PROVIDER;
        this.domain_nondistinct = this.constructor.DOMAIN_NONDISTINCT;
    }

    /**
    * Cleans an email address by applying provider-specific rules and standardizations
    * @param {string} email - The email address to clean
    * @returns {string} The cleaned email address with applied rules and standardizations
    * 
    * Splits email into local and domain parts, applies provider-specific rules like:
    * - Removing dots for certain providers (Gmail, iCloud)
    * - Handling subaddressing (removing +suffix)
    * - Normalizing domains (e.g. googlemail.com -> gmail.com)
    */
    clean (email) {
        const eml = (() => {
            const [local, domain] = email.split('@');
            return { local, domain };
        })();

        if ( this.domain_nondistinct[eml.domain] ) {
            eml.domain = this.domain_nondistinct[eml.domain];
        }

        const rules = [
            'remove_subaddressing',
        ];

        const provider = this.domain_to_provider[eml.domain] || eml.domain;
        const provider_info = this.providers[provider];
        if ( provider_info ) {
            provider_info.rules = provider_info.rules || [];
            provider_info.rmrules = provider_info.rmrules || [];

            for ( const rule_name of provider_info.rules ) {
                rules.push(rule_name);
            }

            for ( const rule_name of provider_info.rmrules ) {
                const idx = rules.indexOf(rule_name);
                if ( idx !== -1 ) {
                    rules.splice(idx, 1);
                }
            }
        }

        for ( const rule_name of rules ) {
            const rule = this.named_rules[rule_name];
            rule.rule({ eml });
        }

        return eml.local + '@' + eml.domain;
    }
    

    /**
    * Validates an email address against blocked domains and custom validation rules
    * @param {string} email - The email address to validate
    * @returns {Promise<boolean>} True if email is valid, false if blocked or invalid
    * @description First cleans the email, then checks against blocked domains from config.
    * Emits 'email.validate' event to allow custom validation rules. Event handlers can
    * set event.allow=false to reject the email.
    */
    async validate (email) {
        email = this.clean(email);
        const config = this.global_config;

        if ( can(config.blocked_email_domains, 'iterate') ) {
            for ( const suffix of config.blocked_email_domains ) {
                if ( email.endsWith(suffix) ) {
                    return false;
                }
            }
        }

        const svc_event = this.services.get('event');
        const event = { allow: true, email };
        await svc_event.emit('email.validate', event);

        if ( ! event.allow ) return false;
        
        return true;
    }

    _test ({ assert }) {
        const cases = [
            {
                email: 'bob.ross+happy-clouds@googlemail.com',
                expected: 'bobross@gmail.com',
            },
            {
                email: 'under.rated+email-service@yahoo.com',
                expected: 'under.rated+email-service@yahoo.com',
            },
            {
                email: 'the-absolute+best@protonmail.com',
                expected: 'the-absolute@protonmail.com',
            },
        ];

        for ( const { email, expected } of cases ) {
            const cleaned = this.clean(email);
            assert.equal(cleaned, expected, `clean_email(${email}) === ${expected}`);
        }
    }
}

module.exports = { CleanEmailService };
