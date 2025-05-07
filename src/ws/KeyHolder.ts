export class KeyHolder {

    private key: number;
    public keys: Record<string, number>;

    constructor() {
        this.key = 1;
        this.keys = {};
    }

    public createKey(tag: string): void {
        this.key++;
        this.keys[tag] = this.key;
    }
    public createKeys(tags: string[]): void {
        for (const tag of tags) this.createKey(tag);
    }

    public get(key: string): number {
        return this.keys[key];
    }
    public getChar(key: string): string {
        return String.fromCodePoint(this.get(key));
    }

}