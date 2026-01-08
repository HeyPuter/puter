import { IUser } from '../User';

export interface ActorLogFields {
    uid: string;
    username?: string;
}

export class SystemActorType {
    constructor (o?: Record<string, unknown>);
    get uid (): string;
    get_related_type (type_class: unknown): SystemActorType;
}

export class UserActorType {
    constructor (params: { user: IUser });
    user: IUser;
    get uid (): string;
    get_related_type (type_class: unknown): UserActorType;
}

export class AppUnderUserActorType {
    constructor (params: { user: IUser, app: { uid: string } });
    user: IUser;
    app: { uid: string };
    get uid (): string;
    get_related_type (type_class: unknown): UserActorType | AppUnderUserActorType;
}

export class AccessTokenActorType {
    constructor (params: { authorizer: Actor, authorized?: Actor, token: string });
    authorizer: Actor;
    authorized?: Actor;
    token: string;
    get uid (): string;
    get_related_actor (): never;
}

export class SiteActorType {
    constructor (params: { site: { name: string } });
    site: { name: string };
    get uid (): string;
}

export type ActorType =
    | SystemActorType
    | UserActorType
    | AppUnderUserActorType
    | AccessTokenActorType
    | SiteActorType;

export interface ActorInit {
    type: ActorType;
}

export class Actor {
    constructor (init: ActorInit);
    type: {
        app: { uid: string, timestamp?: Date }
        user: IUser
    };
    get uid (): string;
    get private_uid (): string;
    toLogFields (): ActorLogFields;
    clone (): Actor;
    get_related_actor (type_class: unknown): Actor;
    static create (
        type: new (params?: Record<string, unknown>) => ActorType,
        params?: {
            user_uid?: string;
            app_uid?: string;
            user?: IUser;
            app?: { uid: string };
            [key: string]: unknown;
        },
    ): Promise<Actor>;
    static get_system_actor (): Actor;
    static adapt (actor?: Actor | { username?: string, uuid?: string }): Actor;
}
