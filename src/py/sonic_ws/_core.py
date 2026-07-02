# Copyright (c) 2026 Lily (liwybloc)
#
# Licensed for personal, non-commercial use only.
# Commercial use, redistribution, sublicensing, sale, rental, lease,
# or inclusion in a paid product or service is prohibited without prior
# written permission from the copyright holder.
#
# See the LICENSE file in the project root for the full license terms.
#
# License-Identifier: LicenseRef-Lily-Personal-NonCommercial-2026

import ctypes, os, pathlib, struct, sys


class _Buffer(ctypes.Structure):
    _fields_ = [
        ("data", ctypes.POINTER(ctypes.c_ubyte)),
        ("len", ctypes.c_size_t),
        ("capacity", ctypes.c_size_t),
        ("ok", ctypes.c_bool),
    ]


def _load():
    names = {"win32": "_native.dll", "darwin": "_native.dylib"}
    name = names.get(sys.platform, "_native.so")
    candidates = [
        os.getenv("SONIC_WS_CORE_PATH"),
        pathlib.Path(__file__).with_name(name),
        pathlib.Path(__file__).parents[2]
        / "core"
        / "target"
        / "release"
        / name.replace("_native", "libsonic_ws_core"),
        pathlib.Path(__file__).parents[2]
        / "core"
        / "target"
        / "debug"
        / name.replace("_native", "libsonic_ws_core"),
    ]
    for candidate in candidates:
        if candidate and pathlib.Path(candidate).exists():
            return ctypes.CDLL(str(candidate))
    raise ImportError(
        "SonicWS Rust core not found; install the package or run cargo build --release --features python"
    )


_lib = _load()
_lib.sonic_ws_python_call.restype = _Buffer
_lib.sonic_ws_python_call.argtypes = [
    ctypes.c_uint8,
    ctypes.c_uint8,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.c_uint64,
]
_lib.sonic_ws_python_free.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t]
_lib.sonic_ws_python_validate.restype = ctypes.c_bool
_lib.sonic_ws_python_validate.argtypes = [
    ctypes.c_uint8,
    ctypes.c_void_p,
    ctypes.c_size_t,
    ctypes.c_uint64,
    ctypes.c_uint64,
    ctypes.c_bool,
]


def _call(op, kind, data=b"", arg=0):
    raw = bytes(data)
    holder = ctypes.create_string_buffer(raw) if raw else None
    result = _lib.sonic_ws_python_call(op, int(kind), holder, len(raw), arg)
    if not result.ok:
        raise ValueError("Rust codec rejected the value")
    try:
        return ctypes.string_at(result.data, result.len)
    finally:
        _lib.sonic_ws_python_free(result.data, result.len, result.capacity)


def _frame(values):
    out = bytearray()
    for value in values:
        n = len(value)
        while True:
            b = n & 127
            n >>= 7
            out.append(b | (128 if n else 0))
            if not n:
                break
        out.extend(value)
    return bytes(out)


def _unframe(data):
    result = []
    offset = 0
    while offset < len(data):
        n = shift = 0
        while True:
            b = data[offset]
            offset += 1
            n |= (b & 127) << shift
            shift += 7
            if not b & 128:
                break
        result.append(data[offset : offset + n])
        offset += n
    return result


def encode_signed(k, v):
    return _call(1, k, b"".join(struct.pack("<q", x) for x in v))


def decode_signed(k, d):
    r = _call(2, k, d, 0xFFFFFFFF)
    return [x[0] for x in struct.iter_unpack("<q", r)]


def encode_unsigned(k, v):
    return _call(3, k, b"".join(struct.pack("<Q", x) for x in v))


def decode_unsigned(k, d):
    r = _call(4, k, d, 0xFFFFFFFF)
    return [x[0] for x in struct.iter_unpack("<Q", r)]


def encode_floats(k, v):
    return _call(5, k, b"".join(struct.pack("<d", x) for x in v))


def decode_floats(k, d):
    r = _call(6, k, d, 0xFFFFFFFF)
    return [x[0] for x in struct.iter_unpack("<d", r)]


def encode_strings(k, v):
    return _call(7, k, _frame([x.encode() for x in v]))


def decode_strings(k, d):
    return [x.decode() for x in _unframe(_call(8, k, d, 0xFFFFFFFF))]


def encode_booleans(v):
    return _call(9, 14, bytes(v))


def decode_booleans(d, count):
    return [bool(x) for x in _call(10, 14, d, count)]


def decode_raw(d):
    return _call(11, 1, d)


def encode_hex(v):
    return _call(12, 17, v.encode())


def decode_hex(d):
    return _call(13, 17, d).decode()


def frame_object(v):
    return _call(14, 0, _frame(v))


def unframe_object(d, count):
    result = _unframe(_call(15, 0, d))
    if len(result) != count:
        raise ValueError("object field count mismatch")
    return result


def encode_batch(v, compressed):
    return _call(16, bool(compressed), _frame(v))


def decode_batch(d, compressed, max_batch_size=0, max_output_size=None):
    return _unframe(_call(17, bool(compressed), d, max_batch_size))


def deflate_raw(d):
    return _call(18, 0, d)


def inflate_raw(d, max_output_size=None):
    return _call(19, 0, d, max_output_size or 16 * 1024 * 1024)


def validate_encoded(
    k, d, minimum, maximum, compressed=False, batched=False, max_batch_size=0
):
    if batched:
        for value in decode_batch(d, compressed, max_batch_size):
            validate_encoded(k, value, minimum, maximum)
        return
    raw = bytes(d)
    holder = ctypes.create_string_buffer(raw) if raw else None
    if not _lib.sonic_ws_python_validate(
        int(k), holder, len(raw), minimum, maximum, compressed
    ):
        raise ValueError("Rust codec validation failed")
