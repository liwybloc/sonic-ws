export class EnumValue {
    public tag: string;
    public index: number;
    public encoded: string;

    constructor(tag: string, index: number) {
        this.tag = tag;
        this.index = index;
        this.encoded = String.fromCharCode(index);
    }
}
export class EnumPackage {
    public tag: string;
    public values: string[];

    constructor(tag: string, values: string[]) {
        this.tag = tag;
        this.values = values;
    }

    public serialize(): string {
        return String.fromCharCode(this.tag.length + 1) + this.tag + String.fromCharCode(this.values.length + 1) + this.values.map(v => String.fromCharCode(v.length + 1) + v).join("");
    }
}