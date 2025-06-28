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

const { Endpoint } = require("../util/expressutil");
const BaseService = require("./BaseService");

const aws = require('aws-sdk');
const sns = new aws.SNS();
const { LRUCache: LRU } = require('lru-cache');
const crypto = require('crypto');
const axios = require('axios');

const MAX_CERT_RETRIES = 3;
const CERT_RETRY_DELAY = 100;

// SNS signature verification is implemented by this guide:
// https://cloudonaut.io/verify-sns-messages-delivered-via-http-or-https-in-node-js/
//
// There is a node.js module for this but it
// [seems to have issues](https://github.com/aws/aws-js-sns-message-validator/issues/30#issuecomment-985316591)

const SNS_TYPES = {
    SubscriptionConfirmation: {
        signature_fields: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
    },
    Notification: {
        signature_fields: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
    }
};

const CERT_URL_PATTERN = /^https:\/\/sns\.[a-zA-Z0-9-]{3,}\.amazonaws\.com(\.cn)?\/SimpleNotificationService-[a-zA-Z0-9]{32}\.pem$/;

// When testing locally, put a certificate from SNS here
const TEST_CERT = ``;
// When testing locally, put a message from SNS here
const TEST_MESSAGE = {};

class SNSService extends BaseService {
    static MODULES = {
        AWS: require('aws-sdk'),
    };

    _construct () {
        this.cert_cache = new LRU({
            // Guide uses 5000 here but that seems excessive
            max: 50,
            maxAge: 1000 * 60,
        });
    }
    
    _init () {
        const svc_web = this.services.get('web-server');
        svc_web.allow_undefined_origin('/sns', '/sns/');
    }

    async ['__on_install.routes'] (_, { app }) {
        Endpoint({
            route: '/sns',
            methods: ['POST'],
            handler: async (req, res) => {
                const message = req.body;

                console.log('SNS message', { message });

                const REQUIRED_FIELDS = ['SignatureVersion', 'SigningCertURL', 'Type', 'Signature'];
                for ( const field of REQUIRED_FIELDS ) {
                    if ( ! message[field] ) {
                        this.log.info('SES response', { status: 400, because: 'missing field', field });
                        res.status(400).send(`Missing required field: ${field}`);
                        return;
                    }
                }

                if ( ! SNS_TYPES[message.Type] ) {
                    this.log.info('SES response', {
                        status: 400, because: 'invalid Type',
                        value: message.Type,
                    });
                    res.status(400).send('Invalid SNS message type');
                    return;
                }

                if ( message.SignatureVersion !== '1' ) {
                    this.log.info('SES response', {
                        status: 400, because: 'invalid SignatureVersion',
                        value: message.SignatureVersion,
                    });
                    res.status(400).send('Invalid SignatureVersion');
                    return;
                }
        
                if ( ! CERT_URL_PATTERN.test(message.SigningCertURL) ) {
                    this.log.info('SES response', {
                        status: 400, because: 'invalid SigningCertURL',
                        value: message.SignatureVersion,
                    });
                    throw Error('Invalid certificate URL');
                }

                const topic_arns = this.config?.topic_arns ?? [];
                if ( ! topic_arns.includes(message.TopicArn) ) {
                    this.log.info('SES response', {
                        status: 403, because: 'invalid TopicArn',
                        value: message.TopicArn,
                    });
                    res.status(403).send('Invalid TopicArn');
                    return;
                }

                if ( ! await this.verify_message_(message) ) {
                    this.log.info('SES response', {
                        status: 403, because: 'message signature validation',
                        value: message.SignatureVersion,
                    });
                    res.status(403).send('Invalid signature');
                    return;
                }

                if ( message.Type === 'SubscriptionConfirmation' ) {
                    // Confirm subscription
                    const response = await axios.get(message.SubscribeURL);
                    if (response.status !== 200) {
                        res.status(500).send('Failed to confirm subscription');
                        return;
                    }
                }

                const svc_event = this.services.get('event');
                this.log.info('SNS message', { message });
                svc_event.emit('sns', { message });
                res.status(200).send('Thanks SNS');
            },
        }).attach(app);
    }

    _init () {
        this.sns = new this.modules.AWS.SNS();
    }

    async verify_message_ (message, options = {}) {
        let cert;
        if ( options.test_mode ) {
            cert = TEST_CERT;
        } else try {
            cert = await this.get_sns_cert_(message.SigningCertURL);
        } catch (e) {
            throw e;
        }

        const verify = crypto.createVerify('sha1WithRSAEncryption');

        for ( const field of SNS_TYPES[message.Type].signature_fields ) {
            verify.write(`${field}\n${message[field]}\n`);
        }
        verify.end();

        return verify.verify(cert, message.Signature, 'base64');
    }

    async get_sns_cert_ (url) {
        if ( ! CERT_URL_PATTERN.test(url) ) {
            throw Error('Invalid certificate URL');
        }

        const cached = this.cert_cache.get(url);
        if (cached) {
            return cached;
        }

        let cert;
        for ( let i = 0 ; i < MAX_CERT_RETRIES ; i++ ) {
            try {
                const response = await axios.get(url);
                if (response.status !== 200) {
                    throw Error(`Failed to fetch certificate: ${response.status}`);
                }
                cert = response.data;
                break;
            } catch (e) {
                this.log.error('Failed to fetch certificate', { url, error: e });
                await new Promise(rslv => {
                    setTimeout(rslv, CERT_RETRY_DELAY);
                });
            }
        }

        if ( ! cert ) {
            throw Error('Failed to fetch certificate');
        }

        this.cert_cache.set(url, cert);
        return cert;
    }

    async _test ({ assert }) {
        // This test case doesn't work because the specified signing cert
        // from SNS is no longer served.
        // const result = await this.verify_message_({
        //     Type: 'Notification',
        //     MessageId: '4c807a89-9ef9-543b-bfab-2f4ed41e91b4',
        //     TopicArn: 'arn:aws:sns:us-east-1:853553028582:marbot-dev-alert-Topic-8CT7ZJRNSA5Y',
        //     Subject: 'INSUFFICIENT_DATA: "insufficient test" in US East (N. Virginia)',
        //     Message: '{"AlarmName":"insufficient test","AlarmDescription":null,"AWSAccountId":"process.env.AWS_ACCOUNT_ID","NewStateValue":"INSUFFICIENT_DATA","NewStateReason":"tets","StateChangeTime":"2019-08-09T10:19:19.614+0000","Region":"US East (N. Virginia)","OldStateValue":"OK","Trigger":{"MetricName":"CallCount2","Namespace":"AWS/Usage","StatisticType":"Statistic","Statistic":"AVERAGE","Unit":null,"Dimensions":[{"value":"API","name":"Type"},{"value":"PutMetricData","name":"Resource"},{"value":"CloudWatch","name":"Service"},{"value":"None","name":"Class"}],"Period":300,"EvaluationPeriods":1,"ComparisonOperator":"GreaterThanThreshold","Threshold":1.0,"TreatMissingData":"- TreatMissingData:                    missing","EvaluateLowSampleCountPercentile":""}}',
        //     Timestamp: '2019-08-09T10:19:19.644Z',
        //     SignatureVersion: '1',
        //     Signature: 'gnCKAUYX6YlBW3dkOmrSFvdB6r82Q2He+7uZV9072sdCP0DSaR46ka/4ymSdDfqilqxjJ9hajd9l7j8ZsL98vYdUbut/1IJ2hsuALF9nd/HwNLPPWvKXaK/Y3Hp57izOpeBAkuR6koitSbXX50lEj7FraaMVQfpexm01z7IUcx4vCCvZBTdQLbkWw+TYWkWNsMrqarW39zy474SmTBCSZlz1eoV6tCwYk2Z2G2awiXpnfsQRRZvHn4ot176oY+ADAFJ0sIa44effQXq+tAWE6/Z3M5rjtfg6OULDM+NGEmnVZL3xyWK8bIzB48ZclQo3ZsvLPGmCNQLlFpaP/3fGGg==',
        //     SigningCertURL: 'https://sns.us-east-1.amazonaws.com/SimpleNotificationService-6aad65c2f9911b05cd53efda11f913f9.pem',
        //     UnsubscribeURL: 'https://sns.us-east-1.amazonaws.com/?Action=Unsubscribe&SubscriptionArn=arn:aws:sns:us-east-1:853553028582:marbot-dev-alert-Topic-8CT7ZJRNSA5Y:86a160f0-c3c5-4ae1-ae50-2903eede0af1'
        // }, { test_mode: true });

        // If this example validates, we did something wrong
        // assert.equal(result, false, 'does not validate cloudonaut example');

        // Uncomment when a mock exists
        // {
        //     const result = await this.verify_message_(TEST_MESSAGE);
        //     assert.equal(result, true, 'validates working example');
        // }
    }
}

module.exports = {
    SNSService,
};
