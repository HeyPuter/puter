import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./NotificationService.js', () => ({
    UserIDNotifSelector: vi.fn((userId) => ({ userId })),
}));

import { Context } from '../util/context.js';
const { ReferralCodeService } = require('./ReferralCodeService');

const createService = ({ monthlyCount, referredByUser }) => {
    const kvStore = {
        incr: vi.fn().mockResolvedValue({ total: monthlyCount }),
        expireAt: vi.fn().mockResolvedValue(undefined),
    };
    const suService = {
        sudo: vi.fn().mockImplementation(async (runner) => await runner()),
    };
    const meteringService = {
        updateAddonCredit: vi.fn().mockResolvedValue(undefined),
    };
    const sizeService = {
        add_storage: vi.fn().mockResolvedValue(undefined),
    };
    const emailService = {
        send_email: vi.fn().mockResolvedValue(undefined),
    };
    const notificationService = {
        notify: vi.fn(),
    };

    const service = Object.create(ReferralCodeService.prototype);
    service._construct();
    service.getUser = vi.fn().mockResolvedValue(referredByUser);
    service.log = {
        info: vi.fn(),
        debug: vi.fn(),
    };
    service.errors = {
        report: vi.fn(),
    };
    service.services = {
        get: vi.fn((serviceName) => {
            if ( serviceName === 'su' ) return suService;
            if ( serviceName === 'puter-kvstore' ) return kvStore;
            if ( serviceName === 'meteringService' ) return meteringService;
            if ( serviceName === 'notification' ) return notificationService;
            throw new Error(`unexpected service lookup: ${serviceName}`);
        }),
    };

    Context.root.set('services', {
        get: (serviceName) => {
            if ( serviceName === 'sizeService' ) return sizeService;
            if ( serviceName === 'email' ) return emailService;
            if ( serviceName === 'notification' ) return notificationService;
            throw new Error(`unexpected context service lookup: ${serviceName}`);
        },
    });

    return {
        service,
        kvStore,
        suService,
        meteringService,
        sizeService,
        emailService,
        notificationService,
    };
};

describe('ReferralCodeService', () => {
    let previousContextServices;

    beforeEach(() => {
        vi.clearAllMocks();
        previousContextServices = Context.root.get('services');
    });

    afterEach(() => {
        Context.root.set('services', previousContextServices);
    });

    it('awards referral rewards when monthly count is within the 20-user cap', async () => {
        const referredByUser = {
            id: 200,
            uuid: 'referrer-uuid',
            referral_code: 'REF-200',
            username: 'referrer',
        };
        const {
            service,
            kvStore,
            suService,
            meteringService,
            sizeService,
            emailService,
            notificationService,
        } = createService({ monthlyCount: 20, referredByUser });

        await service.on_verified({
            id: 201,
            uuid: 'referred-uuid',
            username: 'referred',
            referred_by: 200,
        });

        expect(suService.sudo).toHaveBeenCalledTimes(1);
        expect(kvStore.incr).toHaveBeenCalledWith({
            key: expect.stringContaining('referral:monthly:user:200:month:'),
            pathAndAmountMap: { total: 1 },
        });
        expect(kvStore.expireAt).toHaveBeenCalledWith({
            key: expect.stringContaining('referral:monthly:user:200:month:'),
            timestamp: expect.any(Number),
        });
        const expiryTimestamp = kvStore.expireAt.mock.calls[0][0].timestamp;
        expect(expiryTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
        expect(sizeService.add_storage).toHaveBeenCalledTimes(2);
        expect(meteringService.updateAddonCredit).toHaveBeenCalledTimes(2);
        expect(emailService.send_email).toHaveBeenCalledTimes(1);
        expect(notificationService.notify).toHaveBeenCalledTimes(1);
    });

    it('skips referral rewards when monthly count exceeds the 20-user cap', async () => {
        const referredByUser = {
            id: 300,
            uuid: 'referrer-uuid',
            referral_code: 'REF-300',
            username: 'referrer',
        };
        const {
            service,
            sizeService,
            meteringService,
            emailService,
            notificationService,
        } = createService({ monthlyCount: 21, referredByUser });

        await service.on_verified({
            id: 301,
            uuid: 'referred-uuid',
            username: 'referred',
            referred_by: 300,
        });

        expect(sizeService.add_storage).not.toHaveBeenCalled();
        expect(meteringService.updateAddonCredit).not.toHaveBeenCalled();
        expect(emailService.send_email).not.toHaveBeenCalled();
        expect(notificationService.notify).not.toHaveBeenCalled();
        expect(service.log.info).toHaveBeenCalledTimes(1);
    });
});
