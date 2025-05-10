// separated file to allow imports
export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw data */
    RAW = 1,

    /** Strings */
    STRINGS = 2,

    /** One or more numbers from -27,648 to 27,647 */
    INTS_C = 3,

    /** One or more numbers of any size. Similar maximum size will produce maximum efficiency */
    INTS_D = 4,

    /** One or more numbers of any size. More efficient for differently sized numbers, worse than INTS_D for similar sized numbers. */
    INTS_A = 5,

    /** One or more decimal numbers of any size */
    DECIMALS = 6,

    /** One or more true/false */
    BOOLEANS = 7,
    
}