class VariantPermutation:
    """Generates non-empty variant combinations while excluding opposites."""

    def __init__(self, values, opposites=None):
        self.values = tuple(values)
        self.opposites = tuple(tuple(pair) for pair in (opposites or ()))
        if not self.values or any(
            not isinstance(value, str) or not value or "," in value
            for value in self.values
        ):
            raise ValueError(
                "Variant permutation values must be non-empty strings without commas"
            )
        if len(set(self.values)) != len(self.values):
            raise ValueError("Variant permutation values must be unique")
        if any(
            len(pair) != 2
            or any(not isinstance(index, int) for index in pair)
            or min(pair) < 0
            or max(pair) >= len(self.values)
            or pair[0] == pair[1]
            for pair in self.opposites
        ):
            raise ValueError("Variant permutation opposite indexes are invalid")
        self._generated = None

    @classmethod
    def from_values(cls, values, opposites=None):
        return cls(values, opposites)

    @classmethod
    def WASD(cls):
        return cls(("W", "A", "S", "D"), ((0, 2), (1, 3)))

    @classmethod
    def Arrows(cls):
        return cls(("Up", "Left", "Down", "Right"), ((0, 2), (1, 3)))

    def generate(self):
        if self._generated is not None:
            return list(self._generated)
        groups = {}
        for group, (left, right) in enumerate(self.opposites):
            groups.setdefault(left, group)
            groups.setdefault(right, group)
        next_group = len(self.opposites)
        for index in range(len(self.values)):
            if index not in groups:
                groups[index] = next_group
                next_group += 1
        generated = []
        for mask in range(1, 1 << len(self.values)):
            indexes = [index for index in range(len(self.values)) if mask & (1 << index)]
            selected = set(indexes)
            if any(left in selected and right in selected for left, right in self.opposites):
                continue
            indexes.sort(key=lambda index: (groups[index], index))
            generated.append((indexes, ",".join(self.values[index] for index in indexes)))
        generated.sort(key=lambda item: (len(item[0]), item[0]))
        self._generated = tuple(value for _, value in generated)
        return list(self._generated)

    def resolve(self, selection):
        if isinstance(selection, dict):
            if set(selection) != set(self.values) or any(
                not isinstance(value, bool) for value in selection.values()
            ):
                raise ValueError(
                    "Variant permutation object must define every known key as a boolean"
                )
            enabled = {value for value in self.values if selection[value]}
        elif isinstance(selection, (list, tuple)):
            if len(selection) != len(self.values) or any(
                not isinstance(value, bool) for value in selection
            ):
                raise ValueError(
                    f"Variant permutation requires {len(self.values)} boolean flags"
                )
            enabled = {
                value for value, selected in zip(self.values, selection) if selected
            }
        else:
            raise TypeError("Variant permutation selection must be a mapping or boolean list")
        if not enabled:
            return ""
        for variant in self.generate():
            if set(variant.split(",")) == enabled:
                return variant
        raise ValueError("Variant permutation contains an invalid or opposite combination")

    def expand(self, variant):
        if variant and variant not in self.generate():
            raise ValueError(f"Unknown generated permutation: {variant}")
        enabled = set(variant.split(",")) if variant else set()
        return {value: value in enabled for value in self.values}
