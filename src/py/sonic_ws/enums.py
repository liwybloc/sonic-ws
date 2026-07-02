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

from dataclasses import dataclass
import math
from typing import Any, Sequence

_packages: dict[str, "EnumPackage"] = {}


def _enum_equal(left: Any, right: Any) -> bool:
    return type(left) is type(right) and (
        left == right
        or (isinstance(left, float) and math.isnan(left) and math.isnan(right))
    )


def enum_index(values: Sequence[Any], value: Any) -> int:
    for index, candidate in enumerate(values):
        if _enum_equal(candidate, value):
            return index
    raise ValueError(f"Value {value!r} does not exist in enum")


@dataclass(frozen=True)
class EnumPackage:
    tag: str
    values: tuple[Any, ...]

    def wrap(self, value: Any) -> int:
        return enum_index(self.values, value)

    def serialize(self) -> bytes:
        types = {str: 0, int: 1, float: 1, bool: 2, type(None): 4}
        output = bytearray(
            [len(self.tag), *self.tag.encode("latin1"), len(self.values)]
        )
        for value in self.values:
            if value is Undefined:
                kind, text = 3, "undefined"
            else:
                kind = types.get(type(value))
                if kind is None:
                    raise TypeError(
                        f"Cannot serialize {type(value).__name__} in an enum"
                    )
                text = (
                    str(value).lower()
                    if isinstance(value, bool)
                    else ("null" if value is None else str(value))
                )
            encoded = text.encode("latin1")
            output.extend((len(encoded), kind, *encoded))
        return bytes(output)


class _Undefined:
    def __repr__(self) -> str:
        return "Undefined"


Undefined = _Undefined()


def define_enum(tag: str, values: Sequence[Any]) -> EnumPackage:
    current = _packages.get(tag)
    value_tuple = tuple(values)
    if current is not None:
        if len(current.values) != len(value_tuple) or any(
            not _enum_equal(left, right)
            for left, right in zip(current.values, value_tuple)
        ):
            raise ValueError(f"Pre-existing enum package {tag!r} is different")
        return current
    if len(values) > 255:
        raise ValueError("An enum can only hold 255 values")
    package = EnumPackage(tag, value_tuple)
    _packages[tag] = package
    return package


def wrap_enum(tag: str, value: Any) -> int:
    try:
        return enum_index(_packages[tag].values, value)
    except KeyError as exc:
        raise ValueError(f"Unknown enum {tag!r}") from exc
    except ValueError as exc:
        raise ValueError(f"Value {value!r} does not exist in enum {tag!r}") from exc


def dewrap_enum(tag: str, value: int) -> Any:
    return _packages[tag].values[value]


DefineEnum = define_enum
WrapEnum = wrap_enum
DeWrapEnum = dewrap_enum
