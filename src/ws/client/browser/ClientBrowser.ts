import { WrapEnum } from "../../enums/EnumHandler";
import { FlattenData, UnFlattenData } from "../../util/PacketUtils";
import { SonicWSCore } from "../core/ClientCore";

const w = window as any;

w.SonicWS = class SonicWS extends SonicWSCore {
    constructor(url: string, protocols?: string | string[]) {
        const ws = new WebSocket(url, protocols);
        super(ws);
    }

    WrapEnum(tag: string, value: string) {
        return WrapEnum(tag, value);
    }

    FlattenData(array: any[][]): any[] {
        return FlattenData(array);
    }

    UnFlattenData(array: any[]): any[][] {
        return UnFlattenData(array);
    }
}