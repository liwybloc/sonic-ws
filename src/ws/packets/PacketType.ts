// separated file to allow imports

/** All different packet types. Use ENUMS for any constant primitive data */
export enum PacketType {
 
    /** No data */
    NONE = 0,

    /** Raw data */
    RAW = 1,

    /** String data; use ENUMS if the values are constant  */
    STRINGS = 2,

    /** Constant primitive data; strings, numbers, booleans, null, undefined */
    ENUMS = 3,

    /** One or more integers from -27,648 to 27,647 */
    INTS_C = 4,
    /** One or more positive integers from 0 to 55,295 */
    UINTS_C = 5,

    /** One or more integers up to MAX_SAFE_INTEGER | 9,007,199,254,740,991 (or negative). Similar maximum size will produce maximum efficiency */
    INTS_D = 6,

    /** One or more integers up to MAX_SAFE_INTEGER | 9,007,199,2554,740,991 (or negative). More efficient for differently sized numbers, but worse than INTS_D for similar sized numbers. */
    INTS_A = 7,

    /** One or more numbers up to MAX_VALUE or 1.7976931348623157e+308. */
    EXPONENTIAL = 8,

    /** One or more numbers of any size */
    DECIMALS = 9,

    /** One or more true/false */
    BOOLEANS = 10,
    
}