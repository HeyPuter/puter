export interface DriverDescriptor {
    iface_name: string;
    service_name?: string;
}

export class Driver {
    constructor (config: DriverDescriptor & { call_backend: unknown });
    call (methodName: string, parameters?: Record<string, unknown>): Promise<unknown>;
}

export class Drivers {
    constructor (context: { authToken?: string; APIOrigin: string; appID?: string });

    setAuthToken (authToken: string): void;
    setAPIOrigin (APIOrigin: string): void;

    list (): Promise<Record<string, unknown>>;
    get (iface_name: string, service_name?: string): Promise<Driver>;
    call (iface_name: string, method_name: string, parameters?: Record<string, unknown>): Promise<unknown>;
    call (iface_name: string, service_name: string, method_name: string, parameters?: Record<string, unknown>): Promise<unknown>;
}
