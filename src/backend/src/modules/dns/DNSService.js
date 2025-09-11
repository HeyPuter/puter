const BaseService = require("../../services/BaseService");
const { sleep } = require("../../util/asyncutil");

/**
 * DNS service that provides DNS client functionality and optional test server
 * @extends BaseService
 */
class DNSService extends BaseService {
    /**
     * Initializes the DNS service by creating a DNS client and optionally starting a test server
     * @returns {Promise<void>}
     */
    async _init () {
        const dns2 = require('dns2');
        // this.dns = new dns2(this.config.client);
        this.dns = new dns2({
            nameServers: ['127.0.0.1'],
            port: 5300,
        });
        
        if ( this.config.test_server ) {
            this.test_server_();
        }
    }
    
    /**
     * Returns the DNS client instance
     * @returns {Object} The DNS client
     */
    get_client () {
        return this.dns;
    }
    
    /**
     * Creates and starts a test DNS server that responds to A and TXT record queries
     * The server listens on port 5300 and returns mock responses for testing purposes
     */
    test_server_ () {
        const dns2 = require('dns2');
        const { Packet } = dns2
        
        const server = dns2.createServer({
            udp: true,
            handle: (request, send, rinfo) => {
                const { questions } = request;
                const response = Packet.createResponseFromRequest(request);
                for (const question of questions) {
                    if (question.type === Packet.TYPE.A || question.type === Packet.TYPE.ANY) {
                        response.answers.push({
                            name: question.name,
                            type: Packet.TYPE.A,
                            class: Packet.CLASS.IN,
                            ttl: 300,
                            address: '127.0.0.11',
                        });
                    }

                    if (question.type === Packet.TYPE.TXT || question.type === Packet.TYPE.ANY) {
                        response.answers.push({
                            name: question.name,
                            type: Packet.TYPE.TXT,
                            class: Packet.CLASS.IN,
                            ttl: 300,
                            data: [
                                JSON.stringify({ username: 'ed3' })
                            ],
                        });
                    }
                }
                send(response);
            }
        });

        server.on('listening', () => {
            this.log.info('Fake DNS server listening', server.addresses());
            
            if ( this.config.test_server_selftest ) (async () => {
                await sleep(5000);
                {
                    console.log('Trying first test')
                    const result = await this.dns.resolveA('test.local');
                    console.log('Test 1', result);
                }
                {
                    console.log('Trying second test')
                    const result = await this.dns.resolve(`_puter-verify.test.local`, 'TXT');
                    console.log('Test 2', result);
                }
            })();
        });
        
        server.on('close', () => {
            console.log('Fake DNS server closed');
            this.log.noticeme('Fake DNS server closed');
        })
        
        server.on('request', (request, response, rinfo) => {
            console.log(request.header.id, request.questions[0]);
        });

        server.on('requestError', (error) => {
            console.log('Client sent an invalid request', error);
        });

        
        server.listen({
            udp: {
                port: 5300,
                address: "127.0.0.1",
            },
        });
    }
}

module.exports = { DNSService };
