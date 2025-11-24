import type { Actor } from './auth/Actor';

export class SUService {
    _construct (): void;
    get_system_actor (): Promise<Actor>;
    sudo<T>(callback: () => Promise<T>): Promise<T>;
    sudo<T>(actorOrCallback: Actor, callback: () => Promise<T>): Promise<T>;
}