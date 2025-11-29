import { IUser } from '../User';

export class SystemActorType {
    get uid (): string;
    get_related_type (type_class: unknown): SystemActorType;
}

export class Actor {
    type: {
        app: { uid: string, timestamp?: Date }
        user: IUser
    };
    get uid (): string;
    clone (): Actor;
    static get_system_actor (): Actor;
    static adapt (actor?: Actor): Actor;
}