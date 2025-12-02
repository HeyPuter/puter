import type { RequestCallbacks } from '../shared.d.ts';
import type { FSItem } from './fs-item.d.ts';

export interface Subdomain extends RequestCallbacks<Subdomain> {
    uid: string;
    subdomain: string;
    root_dir?: FSItem | string | null;
}

export class Hosting {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    list (): Promise<Subdomain[]>;
    create (subdomain: string): Promise<Subdomain>;
    create (subdomain: string, dirPath: string): Promise<Subdomain>;
    create (options: { subdomain: string; root_dir?: string | FSItem }): Promise<Subdomain>;
    update (subdomain: string, dirPath?: string | null): Promise<Subdomain>;
    get (subdomain: string): Promise<Subdomain>;
    delete (subdomain: string): Promise<boolean>;
}
