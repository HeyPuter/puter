export interface ServiceResources {
    services: { get (name: string): any };
    config: Record<string, any> & { services?: Record<string, any>; server_id?: string };
    name?: string;
    args?: any;
    context: { get (key: string): any };
}

export type EventHandler = (id: string, ...args: any[]) => any;

export type Logger = {
    debug: (...args: any[]) => any;
    info: (...args: any[]) => any;
    [key: string]: any;
};

export class BaseService {
    constructor (service_resources: ServiceResources, ...a: any[]);

    args: any;
    service_name: string;
    services: ServiceResources['services'];
    config: Record<string, any>;
    global_config: ServiceResources['config'];
    context: ServiceResources['context'];
    log: Logger;
    errors: any;

    run_as_early_as_possible (): Promise<void>;
    construct (): Promise<void>;
    init (): Promise<void>;
    __on (id: string, args: any[]): Promise<any>;
    protected __get_event_handler (id: string): EventHandler;

    protected _run_as_early_as_possible? (args?: any): any;
    protected _construct? (args?: any): any;
    protected _init? (args?: any): any;
    protected _get_merged_static_object? (key: string): Record<string, any>;

    static LOG_DEBUG?: boolean;
    static CONCERN?: string;
}

export default BaseService;
