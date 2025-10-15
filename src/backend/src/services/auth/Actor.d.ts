export class SystemActorType {
    get uid(): string;
    get_related_type(type_class: any): SystemActorType;
}

export class Actor {
    type: {
        app: { uid: string }
        user: { uuid: string, username: string, email: string, subscription?: (typeof SUB_POLICIES)[keyof typeof SUB_POLICIES]['id'] }
    }
    get uid(): string;
    clone(): Actor;
    static get_system_actor(): Actor;
    static adapt(actor?: any): Actor;
}