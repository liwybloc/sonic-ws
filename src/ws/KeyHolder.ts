export class KeyHolder {

    private key: number;
    public keys: Record<string, number>;

    constructor(keys: string[]) {
        this.key = 1;
        this.keys = {};
        this.createKeys(keys);
    }

    public createKey(tag: string): void {
        if(tag.includes(",")) {
            console.log(`Tag "${tag}" is invalid; keys cannot contain commas.`);
            return;
        }

        this.keys[tag] = this.key;
        this.key++;
    }
    public createKeys(tags: string[]): void {
        for (const tag of tags) this.createKey(tag);
    }

    public get(key: string): number {
        return this.keys[key];
    }
    public getChar(key: string): string {
        return String.fromCharCode(this.get(key));
    }

}