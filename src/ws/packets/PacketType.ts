// separated file to allow imports
export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw data */
    RAW = 1,

    /** String data; use ENUMS if the values are constant  */
    STRINGS = 2,

    /** Constant strings */
    ENUMS = 3,

    /** One or more numbers from -27,648 to 27,647 */
    INTS_C = 4,

    /** One or more numbers of any size. Similar maximum size will produce maximum efficiency */
    INTS_D = 5,

    /** One or more numbers of any size. More efficient for differently sized numbers, worse than INTS_D for similar sized numbers. */
    INTS_A = 6,

    /** One or more decimal numbers of any size */
    DECIMALS = 7,

    /** One or more true/false */
    BOOLEANS = 8,
    
}