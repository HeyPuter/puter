const { LoggerFacade, ArrayLogger, ConsoleLogger } = require("../src/libs/log");
const { expect } = require('chai');

describe('log', () => {
    it('facade logger', () => {
        const array_logger = new ArrayLogger();

        let logger = new LoggerFacade({
            impl: array_logger,
        });

        logger.info('test message only');
        logger.info('test message and values', 1, 2);
        logger = logger.fields({ a: 1 });
        logger.info('test fields', 3, 4);

        const logs = array_logger.buffer;
        expect(logs).to.have.length(3);

        expect(logs[0].level).to.equal('info');
        expect(logs[0].message).to.equal('test message only');
        expect(logs[0].fields).to.eql({});
        expect(logs[0].values).to.eql([]);

        expect(logs[1].level).to.equal('info');
        expect(logs[1].message).to.equal('test message and values');
        expect(logs[1].fields).to.eql({});
        expect(logs[1].values).to.eql([1, 2]);

        expect(logs[2].level).to.equal('info');
        expect(logs[2].message).to.equal('test fields');
        expect(logs[2].fields).to.eql({ a: 1 });
        expect(logs[2].values).to.eql([3, 4]);
    });
    it('console logger', () => {
        let logger = new ConsoleLogger({
            console: console,
        });
        logger = new LoggerFacade({
            impl: logger,
        });

        logger.fields({
            token: 'asdf',
            user: 'joe',
        }).info('Hello, world!', 'v1', 'v2', { a: 1 });
    });
});
