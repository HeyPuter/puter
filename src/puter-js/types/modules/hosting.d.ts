import type { FSItem } from './fs-item.d.ts';

export interface Subdomain {
    uid: string;
    subdomain: string;
    root_dir: FSItem;
}

export class Hosting {
    list (): Promise<Subdomain[]>;

    create (subdomain: string, dirPath: string): Promise<Subdomain>;
    create (options: { subdomain: string; root_dir: string }): Promise<Subdomain>;

    update (subdomain: string, dirPath: string): Promise<Subdomain>;

    get (subdomain: string): Promise<Subdomain>;

    delete (subdomain: string): Promise<{ success: boolean; uid: string }>;
}
