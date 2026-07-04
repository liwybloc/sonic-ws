import json
from pathlib import Path

from sonic_ws import CreatePacket, PacketType


def main():
    corpus = json.loads((Path(__file__).parents[3] / "protocol" / "golden-vectors.json").read_text())
    assert corpus["protocolVersion"] == 24
    for vector in corpus["vectors"]:
        values = vector["values"]
        count = len(values[0]) // 2 if vector["type"] == "HEX" else len(values) if isinstance(values, list) else len(vector.get("schema", ())) or 1
        settings = {
            "tag": vector["name"], "type": getattr(PacketType, vector["type"]),
            "schema": vector.get("schema"), "autoFlatten": vector.get("autoFlatten", False),
            "quantized": vector.get("quantized"),
        }
        if not vector.get("autoFlatten"):
            settings.update(dataMin=1 if vector["type"] == "HEX" else count, dataMax=count)
        packet = CreatePacket(**settings)
        inputs = (values,) if vector.get("schema") else tuple(values)
        encoded = packet.encode(inputs)
        assert encoded.hex() == vector["hex"], vector["name"]
        assert packet.decode(encoded) == (values[0] if vector["type"] == "HEX" else values), vector["name"]
    print(f'passed {len(corpus["vectors"])} shared protocol golden vectors')


if __name__ == "__main__":
    main()
