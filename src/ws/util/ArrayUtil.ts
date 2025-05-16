export function splitArray(arr: any, x: number): any {
    const result: any[] = [];
    for (let i = 0; i < arr.length; i += x)
        result.push(arr.slice(i, i + x));
    return result;
}