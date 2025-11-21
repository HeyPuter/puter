import putility from '@heyputer/putility';
import { RWLock } from '@heyputer/putility/src/libs/promise.js';
import { ProxyFilesystem, TFilesystem } from './definitions.js';
import { uuidv4 } from '../utils.js';

export const ROOT_UUID = '00000000-0000-0000-0000-000000000000';
const TTL = 5 * 1000;

export class CacheFS extends putility.AdvancedBase {
    static PROPERTIES = {
        assocs_path_: () => ({}),
        assocs_uuid_: () => ({}),
        entries: () => ({}),
    };

    get_entry_ei (external_identifier) {
        if ( Array.isArray(external_identifier) ) {
            for ( const ei of external_identifier ) {
                const entry = this.get_entry_ei(ei);
                if ( entry ) return entry;
            }
            return;
        }

        console.log('GET ENTRY EI', external_identifier);

        const internal_identifier =
            this.assocs_path_[external_identifier] ||
            this.assocs_uuid_[external_identifier] ||
            external_identifier;

        if ( ! internal_identifier ) {
            return;
        }
        return this.entries[internal_identifier];
    }

    add_entry ({ id } = {}) {
        const internal_identifier = id ?? uuidv4();
        const entry = {
            id: internal_identifier,
            stat_has: {},
            stat_exp: 0,
            locks: {
                stat: new RWLock(),
                members: new RWLock(),
            },
        };
        this.entries[internal_identifier] = entry;
        return entry;
    }

    assoc_path (path, internal_identifier) {
        console.log('ASSOC PATH', path, internal_identifier);
        this.assocs_path_[path] = internal_identifier;
    }

    assoc_uuid (uuid, internal_identifier) {
        if ( uuid === internal_identifier ) return;
        this.assocs_uuid_[uuid] = internal_identifier;
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
                    const optionsKey = `return${
                        mod.charAt(0).toUpperCase()
                    }${mod.slice(1)}`;
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
                };

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

                // We might have new information to identify a relevant cache entry
                let cent_replaced = !!cent;
                cent = this.cacheFS.get_entry_ei([entry.uid, entry.path]);
                if ( cent ) {
                    if ( cent_replaced ) l.unlock();
                    l = await cent.locks.stat.wlock();
                }

                if ( ! cent ) {
                    cent = this.cacheFS.add_entry({ id: entry.uid });
                    this.cacheFS.assoc_path(entry.path, cent.id);
                    this.cacheFS.assoc_uuid(entry.uid, cent.id);

                    l = await cent.locks.stat.wlock();
                }

                cent.stat = entry;
                cent.stat_has = { ...values_requested };
                // TODO: increase cache TTL once invalidation works
                cent.stat_exp = Date.now() + TTL;

                l.unlock();

                console.log('RETRUNING THE ENTRY', entry);
                return entry;
            },
            readdir: async function (o) {
                let cent = this.cacheFS.get_entry_ei([o.path, o.uid]);

                console.log('CENT', cent, o);
                let stats = null;
                if ( cent && cent.members && cent.members_exp > Date.now() ) {
                    console.log('MEMBERS', cent.members);
                    stats = [];
                    const l = await cent.locks.stat.rlock();

                    for ( const id of cent.members ) {
                        const member = this.cacheFS.get_entry_ei(id);
                        if ( !member || !member.stat || member.stat_exp <= Date.now() ) {
                            console.log('NO MEMBER OR STAT', member);
                            stats = null;
                            break;
                        }
                        console.log('member', member);
                        if ( !o.no_assocs && !member.stat_has.subdomains ) {
                            stats = null;
                            break;
                        }
                        if ( !o.no_assocs && !member.stat_has.apps ) {
                            stats = null;
                            break;
                        }
                        if ( !o.no_thumbs && !member.stat_has.thumbnail ) {
                            stats = null;
                            break;
                        }
                        console.log('PUSHING', member.stat);

                        stats.push(member.stat);
                    }

                    l.unlock();
                }

                console.log('STATS????', stats);
                if ( stats ) {
                    return stats;
                }

                let l;
                if ( cent ) {
                    l = await cent.locks.members.wlock();
                }

                const entries = await this.delegate.readdir(o);
                if ( ! cent ) {
                    cent = this.cacheFS.add_entry(o.uid ? { id: o.uid } : {});
                    if ( o.path ) this.cacheFS.assoc_path(o.path, cent.id);
                    l = await cent.locks.members.wlock();
                }

                let cent_ids = [];
                for ( const entry of entries ) {
                    let entry_cent = this.cacheFS.get_entry_ei([entry.path, entry.uid]);
                    if ( ! entry_cent ) {
                        entry_cent = this.cacheFS.add_entry({ id: entry.uid });
                        this.cacheFS.assoc_path(entry.path, entry.uid);
                    }
                    cent_ids.push(entry_cent.id);
                    // TODO: update_stat_ is not implemented
                    // this.cacheFS.update_stat_(entry_cent, entry, {
                    //     subdomains: ! o.no_assocs,
                    //     apps: ! o.no_assocs,
                    //     thumbnail: ! o.no_thumbs,
                    // });
                    entry_cent.stat = entry;
                    entry_cent.stat_has = {
                        subdomains: !o.no_assocs,
                        apps: !o.no_assocs,
                        thumbnail: !o.no_thumbs,
                    };
                    entry_cent.stat_exp = Date.now() + 1000 * 3;
                }

                cent.members = [];
                for ( const id of cent_ids ) {
                    cent.members.push(id);
                }
                cent.members_exp = Date.now() + TTL;

                l.unlock();

                console.log('CACHE ENTRY?', cent);

                return entries;
            },
        },
    };
}
