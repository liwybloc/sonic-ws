/**
 * Generates valid permutations/combinations of variant values.
 *
 * Opposite pairs prevent invalid combinations from being generated.
 * For example, with WASD:
 *
 * - W and S are opposites
 * - A and D are opposites
 *
 * So `W,S`, `A,D`, `W,A,S`, etc. are excluded.
 */
export class VariantPermutation {

    private readonly values: string[];
    private readonly opposites: [number, number][];
    private generated?: string[];

    /**
     * Creates a new variant permutation generator.
     *
     * @param values The available variant values.
     * @param opposites Optional pairs of indexes that cannot appear together.
     *
     * @example
     * const variants = new VariantPermutation(
     *   ["W", "A", "S", "D"],
     *   [[0, 2], [1, 3]]
     * ).generate();
     */
    constructor(values: string[], opposites?: [number, number][]) {
        if (!values.length || values.some(value => typeof value !== "string" || !value || value.includes(","))) {
            throw new Error("Variant permutation values must be non-empty strings without commas");
        }
        if (new Set(values).size !== values.length) {
            throw new Error("Variant permutation values must be unique");
        }
        for (const [left, right] of opposites ?? []) {
            if (!Number.isInteger(left) || !Number.isInteger(right)
                || left < 0 || right < 0 || left >= values.length || right >= values.length || left === right) {
                throw new Error("Variant permutation opposite indexes are invalid");
            }
        }
        this.values = values;
        this.opposites = opposites ?? [];
    }

    /**
     * Convenience helper for generating variants without manually creating
     * a VariantPermutation instance.
     *
     * @param values The available variant values.
     * @param opposites Optional pairs of indexes that cannot appear together.
     * @returns A variant permutation object.
     */
    static from(values: string[], opposites?: [number, number][]): VariantPermutation {
        return new VariantPermutation(values, opposites);
    }

    /**
     * Generates valid WASD movement combinations.
     *
     * @returns Valid WASD combinations, excluding opposite directions.
     *
     * @example
     * VariantPermutation.WASD();
     * // [
     * //   "W", "A", "S", "D",
     * //   "W,A", "W,D", "S,A", "S,D"
     * // ]
     */
    static WASD(): VariantPermutation {
        return new VariantPermutation(["W", "A", "S", "D"], [[0, 2], [1, 3]]);
    }

    /**
     * Generates valid arrow key movement combinations.
     *
     * @returns Valid arrow key combinations, excluding opposite directions.
     */
    static Arrows(): VariantPermutation {
        return new VariantPermutation(["Up", "Left", "Down", "Right"], [[0, 2], [1, 3]]);
    }

    /**
     * Generates every non-empty valid combination of values.
     *
     * A combination is valid when it does not contain both indexes from any
     * opposite pair. Values inside each generated string are comma-separated.
     *
     * Results are ordered by combination size first, then by directional group
     * order. This keeps movement-style output intuitive, for example:
     *
     * `"S,A"` instead of `"A,S"`.
     *
     * @internal
     * @returns A list of valid comma-separated variant combinations.
     */
    generate(): string[] {
        if (this.generated) return [...this.generated];
        const result: { value: string; indexes: number[] }[] = [];
        const total = 1 << this.values.length;

        const groupOrder = this.createGroupOrder();

        for (let mask = 1; mask < total; mask++) {
            const indexes: number[] = [];

            for (let i = 0; i < this.values.length; i++) {
                if (mask & (1 << i)) {
                    indexes.push(i);
                }
            }

            if (this.containsOpposites(indexes)) {
                continue;
            }

            const orderedIndexes = [...indexes].sort((a, b) => {
                const groupDiff = groupOrder.get(a)! - groupOrder.get(b)!;

                if (groupDiff !== 0) {
                    return groupDiff;
                }

                return a - b;
            });

            result.push({
                indexes: orderedIndexes,
                value: orderedIndexes.map(index => this.values[index]).join(","),
            });
        }

        this.generated = result
            .sort((a, b) => {
                if (a.indexes.length !== b.indexes.length) {
                    return a.indexes.length - b.indexes.length;
                }

                for (let i = 0; i < Math.min(a.indexes.length, b.indexes.length); i++) {
                    if (a.indexes[i] !== b.indexes[i]) {
                        return a.indexes[i] - b.indexes[i];
                    }
                }

                return 0;
            })
            .map(item => item.value);
        return [...this.generated];
    }

    /** Returns the ordered boolean keys used by this permutation. */
    getValues(): string[] {
        return [...this.values];
    }

    /** Resolves boolean flags or a keyed boolean object to a generated variant. */
    resolve(selection: readonly boolean[] | Record<string, boolean>): string {
        const enabled = new Set<string>();
        if (Array.isArray(selection)) {
            if (selection.length !== this.values.length || selection.some(value => typeof value !== "boolean")) {
                throw new Error(`Variant permutation requires ${this.values.length} boolean flags`);
            }
            selection.forEach((value, index) => value && enabled.add(this.values[index]));
        } else {
            const mapping = selection as Record<string, boolean>;
            const keys = Object.keys(mapping);
            if (keys.length !== this.values.length
                || keys.some(key => !this.values.includes(key) || typeof mapping[key] !== "boolean")) {
                throw new Error("Variant permutation object must define every known key as a boolean");
            }
            this.values.forEach(value => mapping[value] && enabled.add(value));
        }
        if (!enabled.size) return "";
        const variant = this.generate().find(candidate => {
            const values = candidate.split(",");
            return values.length === enabled.size && values.every(value => enabled.has(value));
        });
        if (!variant) throw new Error("Variant permutation contains an invalid or opposite combination");
        return variant;
    }

    /** Expands a generated variant name into its keyed boolean representation. */
    expand(variant: string): Record<string, boolean> {
        const enabled = new Set(variant ? variant.split(",") : []);
        if (enabled.size && !this.generate().includes(variant)) {
            throw new Error(`Unknown generated permutation: ${variant}`);
        }
        return Object.fromEntries(this.values.map(value => [value, enabled.has(value)]));
    }

    /**
     * Checks whether a combination contains any invalid opposite pair.
     */
    private containsOpposites(indexes: number[]): boolean {
        const selected = new Set(indexes);

        return this.opposites.some(([a, b]) => selected.has(a) && selected.has(b));
    }

    /**
     * Creates a stable ordering map used for formatting generated combinations.
     *
     * Opposite pairs are treated as directional groups. For WASD:
     *
     * - W/S belong to group 0
     * - A/D belong to group 1
     *
     * This makes diagonals display as `W,A`, `W,D`, `S,A`, `S,D`.
     */
    private createGroupOrder(): Map<number, number> {
        const groupOrder = new Map<number, number>();

        this.opposites.forEach(([a, b], groupIndex) => {
            if (!groupOrder.has(a)) groupOrder.set(a, groupIndex);
            if (!groupOrder.has(b)) groupOrder.set(b, groupIndex);
        });

        let nextGroup = this.opposites.length;

        for (let i = 0; i < this.values.length; i++) {
            if (!groupOrder.has(i)) {
                groupOrder.set(i, nextGroup++);
            }
        }

        return groupOrder;
    }

}
