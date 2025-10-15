export class AlarmService {
    create(id: string, message: string, fields?: object): void;
    clear(id: string): void;
    get_alarm(id: string): object | undefined;
    // Add more methods/properties as needed for MeteringService usage
}