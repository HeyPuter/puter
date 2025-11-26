// Minimal EventService type declaration for MeteringService type safety
export class EventService {
    emit (key: string, data?: any, meta?: any): Promise<void>;
    on (selector: string, callback: Function): { detach: () => void };
    on_all (callback: Function): void;
    get_scoped (scope: string): any;
}