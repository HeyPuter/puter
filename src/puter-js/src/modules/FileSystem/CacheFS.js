import putility from "@heyputer/putility";
import { RWLock } from "@heyputer/putility/src/libs/promise";
import { ProxyFilesystem, TFilesystem } from "./definitions";

export const ROOT_UUID = '00000000-0000-0000-0000-000000000000';

export class CacheFS extends putility.AdvancedBase {
    static PROPERTIES = {
        // 'internal_uuid' maps a path or external UUID to
        // the respective cache entry UUID
        // (which for now is the same as the public UUID)
        internal_uuid: () => ({}),
        entries: () => ({}),
    };

    get_entry_ei (external_identifier) {
        const internal_identifier = this.internal_uuid[external_identifier];
        if ( ! internal_identifier ) {
            return;
        }
        return this.entries[internal_identifier];
    }

    add_entry ({
        external_identifiers,
        internal_identifier,
    }) {
        const entry = {
            stat_has: {},
            stat_exp: 0,
            locks: {
                stat: new RWLock(),
            },
        };
        for ( const ident of external_identifiers ) {
            this.internal_uuid[ident] = internal_identifier;
        }
        this.entries[internal_identifier] = entry;
        console.log('cREATED ENTRY', this.internal_uuid, this.entries);
        return entry;
    }
}

export class CachedFilesystem extends ProxyFilesystem {
    constructor (o) {
        super(o);
        // this.cacheFS = cacheFS;
        this.cacheFS = new CacheFS();
    }
    static IMPLEMENTS = {
        [TFilesystem]: {
            stat: async function (o) {
                let cent = this.cacheFS.get_entry_ei(o.path ?? o.uid);

                const modifiers = [
                    'subdomains',
                    'permissions',
                    'versions',
                    'size',
                ];

                let values_requested = {};
                for ( const mod of modifiers ) {
                    const optionsKey = 'return' +
                        mod.charAt(0).toUpperCase() +
                        mod.slice(1);
                    if ( ! o[optionsKey] ) continue;
                    values_requested[mod] = true;
                }

                const satisfactory_cache = cent => {
                    for ( const mod of modifiers ) {
                        if ( ! values_requested[mod] ) continue;
                        if ( ! cent.stat_has[mod] ) {
                            return false;
                        }
                    }
                    return true;
                }
                
                let cached_stat;
                if ( cent && cent.stat && cent.stat_exp > Date.now() ) {
                    const l = await cent.locks.stat.rlock();
                    if ( satisfactory_cache(cent) ) {
                        cached_stat = cent.stat;
                    }
                    l.unlock();
                }

                if ( cached_stat ) {
                    console.log('CACHE HIT');
                    return cached_stat;
                }
                console.log('CACHE MISS');

                let l;
                if ( cent ) {
                    l = await cent.locks.stat.wlock();
                }

                console.log('DOING THE STAT', o);
                const entry = await this.delegate.stat(o);

                if ( ! cent ) {
                    cent = this.cacheFS.add_entry({
                        external_identifiers: [entry.path, entry.uid],
                        internal_identifier: entry.uid,
                    });
                    l = await cent.locks.stat.wlock();
                }

                cent.stat = entry;
                cent.stat_has = { ...values_requested };
                // TODO: increase cache TTL once invalidation works
                cent.stat_exp = Date.now() + 1000*3;

                l.unlock();

                console.log('RETRUNING THE ENTRY', entry);
                return entry;
            }
        }
    }
}
