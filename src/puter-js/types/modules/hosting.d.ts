import type { FSItem } from './fs-item.d.ts';

/** A subdomain hosted on Puter, containing its details. */
export interface Subdomain {
    /** Unique identifier of the subdomain. */
    uid: string;
    /** Name of the subdomain, i.e. the part before the main domain (e.g. `example` in `example.puter.site`). */
    subdomain: string;
    /** The root directory of the subdomain, where its files are stored. */
    root_dir: FSItem;
}

/** Deploy and manage websites on Puter by hosting directories under subdomains. */
export class Hosting {
    /**
     * Lists all subdomains belonging to the user that this app has access to.
     * Resolves to an empty array if the user has no subdomains.
     */
    list (): Promise<Subdomain[]>;

    /**
     * Creates a new subdomain served by the hosting service from the given directory.
     * Rejects if a subdomain with the given name already exists or if the path does not exist.
     */
    create (subdomain: string, dirPath: string): Promise<Subdomain>;
    create (options: { subdomain: string; root_dir: string }): Promise<Subdomain>;

    /**
     * Updates a subdomain to point to a new directory.
     * Rejects if the subdomain does not exist or if the path does not exist.
     */
    update (subdomain: string, dirPath: string): Promise<Subdomain>;

    /** Retrieves a subdomain by name. Rejects if the subdomain does not exist. */
    get (subdomain: string): Promise<Subdomain>;

    /**
     * Deletes a subdomain from the account; it will no longer be served. The associated
     * directory is disconnected but not deleted. Rejects if the subdomain does not exist.
     */
    delete (subdomain: string): Promise<{ success: boolean; uid: string }>;
}
