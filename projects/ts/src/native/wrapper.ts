import { PacketType } from "../ws/packets/PacketType";
import { EnumPackage, EnumValue } from "../ws/util/enums/EnumType";

export interface SonicNativeCore {
    encodeSigned(kind: number, values: number[]): Uint8Array;
    decodeSigned(kind: number, data: Uint8Array): number[];
    encodeUnsigned(kind: number, values: number[]): Uint8Array;
    decodeUnsigned(kind: number, data: Uint8Array): number[];
    encodeFloats(kind: number, values: number[]): Uint8Array;
    decodeFloats(kind: number, data: Uint8Array): number[];
    encodeStrings(kind: number, values: string[]): Uint8Array;
    decodeStrings(kind: number, data: Uint8Array): string[];
    encodeBooleans(values: boolean[]): Uint8Array;
    decodeBooleans(data: Uint8Array, count: number): boolean[];
    decodeRaw(data: Uint8Array): Uint8Array;
    encodeHex(value: string): Uint8Array;
    decodeHex(data: Uint8Array): string;
    frameObject(sectors: Uint8Array[]): Uint8Array;
    unframeObject(data: Uint8Array, fieldCount: number): Uint8Array[];
    encodeBatch(payloads: Uint8Array[], compress: boolean): Uint8Array;
    decodeBatch(data: Uint8Array, compressed: boolean, maxBatchSize: number, maxOutputSize?: number): Uint8Array[];
    deflateRaw(data: Uint8Array): Uint8Array;
    inflateRaw(data: Uint8Array, maxOutputSize?: number): Uint8Array;
    validateEncoded(kind: number, data: Uint8Array, min: number, max: number,
        compressed: boolean, batched: boolean, maxBatchSize?: number): void;
    validateEnum(data: Uint8Array, enumSize: number, min: number, max: number): void;
    validateObject(data: Uint8Array, kinds: number[], minimums: number[],
        maximums: number[], enumSizes: number[]): void;
}

export interface NativeObjectSchema {
    types: readonly PacketType[];
    dataMins: readonly number[];
    dataMaxes: readonly number[];
    enumData?: readonly EnumPackage[];
}

let loadedCore: SonicNativeCore | undefined;

function buffer(data: Uint8Array): Uint8Array {
    if (typeof Buffer !== "undefined") return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function values<T>(input: T | readonly T[]): T[] {
    return Array.isArray(input) ? [...input] : [input as T];
}

function assertNativeCore(value: Partial<SonicNativeCore>): asserts value is SonicNativeCore {
    const required: (keyof SonicNativeCore)[] = [
        "encodeSigned", "decodeSigned", "encodeUnsigned", "decodeUnsigned",
        "encodeFloats", "decodeFloats", "encodeStrings", "decodeStrings",
        "encodeBooleans", "decodeBooleans", "decodeRaw",
        "encodeHex", "decodeHex", "frameObject", "unframeObject",
        "encodeBatch", "decodeBatch", "deflateRaw", "inflateRaw",
        "validateEncoded", "validateEnum", "validateObject",
    ];
    const missing = required.filter(name => typeof value[name] !== "function");
    if (missing.length > 0) throw new Error(`Invalid SonicWS native addon; missing: ${missing.join(", ")}`);
}

/** Injects a native implementation, primarily for tests or custom addon loaders. */
export function setNativeCore(core: SonicNativeCore): void {
    assertNativeCore(core);
    loadedCore = core;
}

/** Loads and selects the webpack-compatible browser WASM implementation. */
export async function initializeWasmCore(): Promise<SonicNativeCore> {
    const wasm = typeof window === "undefined"
        ? (eval("require") as NodeJS.Require)("./wasm/node/sonic_ws_core.js")
        : await import(/* webpackMode: "eager" */ "./wasm/pkg/sonic_ws_core.js");
    setNativeCore(wasm as unknown as SonicNativeCore);
    return loadedCore!;
}

/** Loads the platform-specific Node addon lazily. */
export function loadNativeCore(addonPath?: string): SonicNativeCore {
    if (loadedCore && !addonPath) return loadedCore;

    const candidates = addonPath
        ? [addonPath]
        : [
            typeof process !== "undefined" ? process.env.SONIC_WS_CORE_PATH : undefined,
            typeof __dirname !== "undefined" ? `${__dirname}/sonic_ws_core.node` : undefined,
            typeof __dirname !== "undefined" ? `${__dirname}/../../../native/sonic_ws_core.node` : undefined,
        ].filter((candidate): candidate is string => Boolean(candidate));

    const failures: string[] = [];
    const nodeRequire = typeof window === "undefined" ? eval("require") as NodeRequire : undefined;
    for (const candidate of candidates) {
        try {
            const core = nodeRequire!(candidate) as Partial<SonicNativeCore>;
            assertNativeCore(core);
            if (!addonPath) loadedCore = core;
            return core;
        } catch (error) {
            failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    if (typeof window === "undefined") {
        try {
            const wasm = nodeRequire!("./wasm/node/sonic_ws_core.js") as Partial<SonicNativeCore>;
            assertNativeCore(wasm);
            loadedCore = wasm;
            return wasm;
        } catch (error) {
            failures.push(`Node WASM fallback: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    throw new Error(`SonicWS codec is not initialized. In Node, set SONIC_WS_CORE_PATH; in browsers, await initializeWasmCore().\n${failures.join("\n")}`);
}

function enumIndex(pkg: EnumPackage, value: EnumValue): number {
    const index = pkg.values.findIndex((candidate: unknown) => candidate === value
        || (typeof candidate === "number" && typeof value === "number"
            && Number.isNaN(candidate) && Number.isNaN(value)));
    if (index < 0) throw new Error(`Value ${String(value)} does not exist in enum ${pkg.tag}`);
    return index;
}

export function encodeNative(
    type: PacketType,
    input: unknown,
    enumData?: EnumPackage,
    core = loadNativeCore(),
): Uint8Array {
    switch (type) {
        case PacketType.NONE:
            if (input != null && (!Array.isArray(input) || input.length !== 0))
                throw new TypeError("NONE only accepts null, undefined, or an empty array");
            return new Uint8Array(0);
        case PacketType.RAW:
        case PacketType.JSON:
            if (!(input instanceof Uint8Array) && !Array.isArray(input))
                throw new TypeError(`${type === PacketType.JSON ? "JSON wire data" : "RAW"} requires a Uint8Array or number array`);
            return input instanceof Uint8Array ? buffer(input) : Uint8Array.from(input as number[]);
        case PacketType.BYTES:
        case PacketType.SHORTS:
        case PacketType.VARINT:
        case PacketType.DELTAS:
            return core.encodeSigned(type, values(input as number | number[]));
        case PacketType.UBYTES:
        case PacketType.USHORTS:
        case PacketType.UVARINT:
            return core.encodeUnsigned(type, values(input as number | number[]));
        case PacketType.FLOATS:
        case PacketType.DOUBLES:
            return core.encodeFloats(type, values(input as number | number[]));
        case PacketType.STRINGS_ASCII:
        case PacketType.STRINGS_UTF16:
            return core.encodeStrings(type, values(input as string | string[]));
        case PacketType.BOOLEANS:
            return core.encodeBooleans(values(input as boolean | boolean[]));
        case PacketType.HEX: {
            const hex = Array.isArray(input) ? input[0] : input;
            if (typeof hex !== "string") throw new TypeError("HEX requires one string");
            return core.encodeHex(hex);
        }
        case PacketType.ENUMS:
            if (!enumData) throw new Error("ENUMS requires an EnumPackage");
            return Uint8Array.from(values(input as EnumValue | EnumValue[]).map(value => enumIndex(enumData, value)));
        case PacketType.KEY_EFFECTIVE:
            throw new Error("KEY_EFFECTIVE is not implemented");
        default:
            throw new Error(`Unknown packet type: ${type}`);
    }
}

export function decodeNative(
    type: PacketType,
    data: Uint8Array,
    dataMax = 0xffffffff,
    enumData?: EnumPackage,
    core = loadNativeCore(),
): unknown {
    const input = buffer(data);
    switch (type) {
        case PacketType.NONE:
            if (data.byteLength !== 0) throw new Error("NONE packet contains data");
            return undefined;
        case PacketType.RAW:
        case PacketType.JSON: return core.decodeRaw(input);
        case PacketType.BYTES:
        case PacketType.SHORTS:
        case PacketType.VARINT:
        case PacketType.DELTAS: return core.decodeSigned(type, input);
        case PacketType.UBYTES:
        case PacketType.USHORTS:
        case PacketType.UVARINT: return core.decodeUnsigned(type, input);
        case PacketType.FLOATS:
        case PacketType.DOUBLES: return core.decodeFloats(type, input);
        case PacketType.STRINGS_ASCII:
        case PacketType.STRINGS_UTF16: return core.decodeStrings(type, input);
        case PacketType.BOOLEANS: return core.decodeBooleans(input, dataMax);
        case PacketType.HEX: return core.decodeHex(input);
        case PacketType.ENUMS:
            if (!enumData) throw new Error("ENUMS requires an EnumPackage");
            return [...data].map(index => {
                if (index >= enumData.values.length) throw new Error(`Enum index ${index} is out of range`);
                return enumData.values[index];
            });
        case PacketType.KEY_EFFECTIVE:
            throw new Error("KEY_EFFECTIVE is not implemented");
        default:
            throw new Error(`Unknown packet type: ${type}`);
    }
}

export function validateNative(
    type: PacketType,
    data: Uint8Array,
    dataMin: number,
    dataMax: number,
    options: { compressed?: boolean; batched?: boolean; maxBatchSize?: number; enumData?: EnumPackage } = {},
    core = loadNativeCore(),
): void {
    if (type === PacketType.ENUMS) {
        if (!options.enumData) throw new Error("ENUMS requires an EnumPackage");
        core.validateEnum(buffer(data), options.enumData.values.length, dataMin, dataMax);
        return;
    }
    core.validateEncoded(type, buffer(data), dataMin, dataMax,
        options.compressed ?? false, options.batched ?? false, options.maxBatchSize);
}

export function encodeNativeObject(
    schema: NativeObjectSchema,
    fields: readonly unknown[],
    core = loadNativeCore(),
): Uint8Array {
    if (fields.length !== schema.types.length) throw new Error("Object field count does not match schema");
    let enumIndex = 0;
    const sectors = schema.types.map((type, index) => encodeNative(
        type, fields[index], type === PacketType.ENUMS ? schema.enumData?.[enumIndex++] : undefined, core));
    return core.frameObject(sectors);
}

export function decodeNativeObject(
    schema: NativeObjectSchema,
    data: Uint8Array,
    core = loadNativeCore(),
): unknown[] {
    const sectors = core.unframeObject(buffer(data), schema.types.length);
    let enumIndex = 0;
    return sectors.map((sector, index) => decodeNative(schema.types[index], sector,
        schema.dataMaxes[index], schema.types[index] === PacketType.ENUMS
            ? schema.enumData?.[enumIndex++] : undefined, core));
}

export function validateNativeObject(
    schema: NativeObjectSchema,
    data: Uint8Array,
    core = loadNativeCore(),
): void {
    core.validateObject(buffer(data), [...schema.types], [...schema.dataMins], [...schema.dataMaxes],
        (schema.enumData ?? []).map(pkg => pkg.values.length));
}

export function encodeNativeBatch(
    payloads: readonly Uint8Array[],
    compressed: boolean,
    core = loadNativeCore(),
): Uint8Array {
    return core.encodeBatch(payloads.map(buffer), compressed);
}

export function decodeNativeBatch(
    data: Uint8Array,
    compressed: boolean,
    maxBatchSize = 0,
    maxOutputSize?: number,
    core = loadNativeCore(),
): Uint8Array[] {
    const nativeLimit = Number.isFinite(maxBatchSize) && maxBatchSize > 0 ? maxBatchSize : 0;
    return core.decodeBatch(buffer(data), compressed, nativeLimit, maxOutputSize);
}

export function deflateNative(data: Uint8Array, core = loadNativeCore()): Uint8Array {
    return core.deflateRaw(buffer(data));
}

export function inflateNative(data: Uint8Array, maxOutputSize?: number, core = loadNativeCore()): Uint8Array {
    return core.inflateRaw(buffer(data), maxOutputSize);
}
