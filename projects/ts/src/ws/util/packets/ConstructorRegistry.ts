export type PacketConstructor<T = any> = new (values: Record<string, any>) => T;

const constructors = new Map<string, PacketConstructor>();

/** Registers a local class that packet schema metadata may reference by name. */
export function RegisterPacketConstructor<T extends PacketConstructor>(constructor: T): T {
    const name = constructor.name;
    if (!name) throw new Error("Packet constructors must have a stable class name");
    const existing = constructors.get(name);
    if (existing && existing !== constructor)
        throw new Error(`A different packet constructor named "${name}" is already registered`);
    constructors.set(name, constructor);
    return constructor;
}

/** Removes a registered packet class, primarily for tests and hot reload. */
export function UnregisterPacketConstructor(name: string): void {
    constructors.delete(name);
}

/** @internal */
export function resolvePacketConstructor(name: string): PacketConstructor {
    const constructor = constructors.get(name);
    if (!constructor)
        throw new Error(`Packet constructor "${name}" is not registered locally. Call RegisterPacketConstructor(${name}) before decoding.`);
    return constructor;
}
