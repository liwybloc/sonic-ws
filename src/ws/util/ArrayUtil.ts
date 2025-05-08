export function splitArray<T>(arr: T[], size: number): T[][] {
    return [...Array(Math.ceil(arr.length / size))].map((_, i) => arr.slice(i * size, i * size + size));
}