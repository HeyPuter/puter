export class Driver {
    readonly iface_name: string;
    call (methodName: string, parameters?: Record<string, unknown>): Promise<unknown>;
}

export class Drivers {
    list (): Promise<Record<string, unknown>>;
    get (ifaceName: string): Promise<Driver>;
    call (ifaceName: string, methodName: string, parameters?: Record<string, unknown>): Promise<unknown>;
    call (ifaceName: string, parameters?: Record<string, unknown>): Promise<unknown>;
}
