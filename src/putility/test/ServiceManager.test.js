const { expect } = require('chai');
const { Service } = require('../src/concepts/Service.js');
const { ServiceManager } = require('../src/system/ServiceManager.js');

class TestService extends Service {
    _construct ({ name, depends }) {
        this.name_ = name;
        this.depends_ = depends;
        this.initialized_ = false;
    }
    get_depends () {
        return this.depends_;
    }
    async _init () {
        // to ensure init is correctly awaited in tests
        await new Promise(rslv => setTimeout(rslv, 0));

        this.initialized_ = true;
    }
}

describe('ServiceManager', () => {
    it('handles dependencies', async () => {
        const serviceMgr = new ServiceManager();

        // register a service with two depends; it will start last
        await serviceMgr.register('a', TestService, {
            parameters: {
                name: 'a',
                depends: ['b', 'c'],
            },
        });

        let a_info = serviceMgr.info('a');
        expect(a_info.status.describe()).to.equal('waiting for: b, c');

        // register a service with no depends; should start right away
        await serviceMgr.register('b', TestService, {
            parameters: {
                name: 'b',
                depends: []
            }
        });

        let b_info = serviceMgr.info('b');
        expect(b_info.status.label).to.equal('running');

        a_info = serviceMgr.info('a');
        expect(a_info.status.describe()).to.equal('waiting for: c');

        await serviceMgr.register('c', TestService, {
            parameters: {
                name: 'c',
                depends: ['b']
            }
        });

        let c_info = serviceMgr.info('c');
        expect(c_info.status.label).to.equal('running');
        a_info = serviceMgr.info('a');
        expect(a_info.status.label).to.equal('running');
        b_info = serviceMgr.info('b');
        expect(b_info.status.label).to.equal('running');
    });
});
