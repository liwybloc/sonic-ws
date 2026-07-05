import unittest

from sonic_ws import (
    PacketType,
    CreatePacket,
    CreateObjPacket,
    CreatePacketGroup,
    CreatePacketManifest,
    LoadPacketManifest,
    ValidatePacketSchema,
    AssertPacketSchema,
    VariantPermutation,
    PacketHolder,
)


class FeatureTests(unittest.TestCase):
    def test_schema_constructor(self):
        class MovementValue:
            def __init__(self, values):
                self.x, self.y, self.z = values["x"], values["y"], values["z"]

        packet = CreatePacket(
            tag="constructed",
            type=PacketType.VARINT,
            schema=["x", "y", "z"],
            dataMax=3,
            constructor=MovementValue,
        )
        value = packet.decode(packet.encode((MovementValue({"x": 1, "y": 2, "z": 3}),)))
        self.assertIsInstance(value, MovementValue)
        self.assertEqual((value.x, value.y, value.z), (1, 2, 3))
        restored, _ = type(packet).deserialize(packet.serialize())
        self.assertEqual(restored.constructor_name, "MovementValue")
        self.assertIsInstance(
            restored.decode(restored.encode(({"x": 4, "y": 5, "z": 6},))), MovementValue
        )

    def test_schema_object_matches_positional_wire(self):
        packet = CreatePacket(
            tag="move",
            type=PacketType.VARINT,
            schema=["dx", "dy", "dz"],
            dataMin=3,
            dataMax=3,
        )
        self.assertEqual(
            packet.encode(({"dx": 1, "dy": 2, "dz": 3},)), packet.encode((1, 2, 3))
        )
        self.assertEqual(
            packet.decode(packet.encode((1, 2, 3))), {"dx": 1, "dy": 2, "dz": 3}
        )
        with self.assertRaisesRegex(ValueError, "missing schema field"):
            packet.encode(({"dx": 1, "dy": 2},))
        with self.assertRaisesRegex(ValueError, "unknown schema field"):
            packet.encode(({"dx": 1, "dy": 2, "dz": 3, "extra": 4},))

    def test_row_major_auto_flatten(self):
        packet = CreatePacket(
            tag="rows", type=PacketType.VARINT, schema=["id", "x"], autoFlatten=True
        )
        rows = [{"id": 1, "x": 10}, {"id": 2, "x": 20}]
        self.assertEqual(packet.prepare_send((rows,)), [1, 10, 2, 20])
        self.assertEqual(packet.decode(packet.encode((rows,))), rows)
        with self.assertRaisesRegex(ValueError, "not divisible"):
            packet.finish_receive([1, 2, 3])

    def test_column_major_auto_transpose(self):
        packet = CreateObjPacket(
            tag="columns",
            types=[PacketType.VARINT, PacketType.STRINGS_ASCII],
            schema=["x", "label"],
            autoTranspose=True,
            noDataRange=True,
        )
        rows = [{"x": 1, "label": "one"}, {"x": 2, "label": "two"}]
        self.assertEqual(packet.prepare_send((rows,)), [[1, 2], ["one", "two"]])
        self.assertEqual(packet.decode(packet.encode((rows,))), rows)
        legacy = CreateObjPacket(
            tag="legacy",
            types=[PacketType.VARINT, PacketType.VARINT],
            autoFlatten=True,
            noDataRange=True,
        )
        self.assertEqual(
            legacy.decode(legacy.encode(([[1, 2], [3, 4]],))), [[1, 2], [3, 4]]
        )

    def test_quantization_and_bounds(self):
        packet = CreatePacket(
            tag="q",
            type=PacketType.SHORTS,
            schema=["x", "y"],
            dataMin=2,
            dataMax=2,
            quantized={"scale": 100, "trackError": True},
            min=-1,
            max=1,
        )
        self.assertEqual(packet.prepare_send(({"x": 0.5, "y": -0.5},)), [50, -50])
        self.assertEqual(
            packet.decode(packet.encode(({"x": 0.5, "y": -0.5},))),
            {"x": 0.5, "y": -0.5},
        )
        with self.assertRaisesRegex(ValueError, "exceeds maximum"):
            packet.encode(({"x": 2, "y": 0},))
        with self.assertRaisesRegex(ValueError, "exceeds maximum"):
            packet.finish_receive([200, 0])

    def test_quantization_error_feedback(self):
        packet = CreatePacket(
            tag="feedback", type=PacketType.VARINT, quantized={"scale": 1024}
        )
        self.assertTrue(packet.quantized["trackError"])
        self.assertEqual(packet.prepare_send([1.5283], 1), [1565])
        self.assertEqual(packet.prepare_send([1.5283], 2), [1565])
        total = 1565 + sum(packet.prepare_send([1.5283], 1)[0] for _ in range(999))
        self.assertLessEqual(abs(total / 1024 - 1528.3), 0.5 / 1024)
        stateless = CreatePacket(
            tag="stateless",
            type=PacketType.VARINT,
            quantized={"scale": 1024, "trackError": False},
        )
        self.assertEqual(
            [stateless.prepare_send([1.5283])[0] for _ in range(2)], [1565, 1565]
        )

    def test_metadata_roundtrip_and_groups(self):
        packet = CreatePacket(
            tag="m",
            type=PacketType.VARINT,
            schema=["x"],
            dataMin=1,
            dataMax=1,
            quantized={"scale": 10},
            min=-2,
            max=2,
            replay=True,
        )
        restored, consumed = type(packet).deserialize(packet.serialize())
        self.assertEqual(consumed, len(packet.serialize()))
        self.assertEqual(restored.schema, ("x",))
        self.assertEqual(restored.quantized["scale"], 10)
        self.assertTrue(restored.replay)
        with self.assertRaisesRegex(ValueError, "replay.*batching"):
            CreatePacket(tag="invalid", replay=True, dataBatching=1)
        group = CreatePacketGroup(
            tag="movement",
            variants={
                "still": {"type": PacketType.NONE},
                "move": {"type": PacketType.VARINT, "schema": ["x"], "dataMax": 1},
            },
        )
        self.assertEqual(
            [item.tag for item in group],
            ["movement", "movement.still", "movement.move"],
        )
        self.assertTrue(group[0].is_parent)
        self.assertEqual(group[0].variant, "")
        self.assertEqual(
            group[0].decode(group[0].encode(())), {"variant": "", "payload": None}
        )
        self.assertEqual(group[2].parent, "movement")
        self.assertEqual(group[2].variant, "move")
        directional = CreatePacketGroup(
            tag="directional",
            variants=["W", "A", "S", "D"],
            defaults={"type": PacketType.SHORTS},
        )
        self.assertEqual(
            [packet.tag for packet in directional],
            [
                "directional",
                "directional.W",
                "directional.A",
                "directional.S",
                "directional.D",
            ],
        )
        self.assertTrue(
            all(packet.type == PacketType.SHORTS for packet in directional[1:])
        )
        overridden = CreatePacketGroup(
            tag="overridden",
            variants={"W": {}, "A": {"type": PacketType.SHORTS}},
            defaults={"type": PacketType.USHORTS},
        )
        self.assertEqual(overridden[1].type, PacketType.USHORTS)
        self.assertEqual(overridden[2].type, PacketType.SHORTS)
        delegated = CreatePacketGroup(
            tag="delegated",
            variants=["v1", "v2"],
            delegate={"type": PacketType.UBYTES},
        )
        self.assertTrue(
            all(packet.type == PacketType.UBYTES for packet in delegated[1:])
        )
        with self.assertRaisesRegex(ValueError, "require defaults"):
            CreatePacketGroup(tag="missing-defaults", variants=["v1"])
        with self.assertRaisesRegex(ValueError, "both defaults and delegate"):
            CreatePacketGroup(
                tag="conflicting-defaults",
                variants=["v1"],
                defaults={"type": PacketType.BYTES},
                delegate={"type": PacketType.UBYTES},
            )
        with self.assertRaisesRegex(ValueError, "duplicate variant"):
            CreatePacketGroup(
                tag="duplicate-variants",
                variants=["v1", "v1"],
                defaults={"type": PacketType.BYTES},
            )
        permutation = VariantPermutation.WASD()
        self.assertEqual(
            permutation.generate(),
            ["W", "A", "S", "D", "W,A", "W,D", "S,A", "S,D"],
        )
        self.assertEqual(
            permutation.resolve({"W": True, "A": True, "S": False, "D": False}),
            "W,A",
        )
        self.assertEqual(permutation.resolve([False, True, True, False]), "S,A")
        self.assertEqual(
            permutation.expand("W,A"),
            {"W": True, "A": True, "S": False, "D": False},
        )
        with self.assertRaisesRegex(ValueError, "opposite"):
            permutation.resolve([True, False, True, False])
        permutation_group = CreatePacketGroup(
            tag="permutation",
            variants=permutation,
            defaults={"type": PacketType.SHORTS, "dataMin": 1, "dataMax": 1},
        )
        self.assertEqual(
            [packet.tag for packet in permutation_group],
            [
                "permutation",
                "permutation.W",
                "permutation.A",
                "permutation.S",
                "permutation.D",
                "permutation.W,A",
                "permutation.W,D",
                "permutation.S,A",
                "permutation.S,D",
            ],
        )
        self.assertEqual(
            permutation_group[5].permutation(),
            {"W": True, "A": True, "S": False, "D": False},
        )
        restored_permutation = LoadPacketManifest(
            CreatePacketManifest(
                client_packets=permutation_group, server_packets=[]
            )
        )["client_packets"]
        self.assertEqual(
            restored_permutation[5].permutation(),
            {"W": True, "A": True, "S": False, "D": False},
        )
        holder = PacketHolder(restored_permutation)
        self.assertEqual(
            holder.permutation_tag(
                "permutation",
                {"W": True, "A": True, "S": False, "D": False},
            ),
            "permutation.W,A",
        )
        self.assertEqual(
            holder.permutation_tag("permutation", [False, False, True, True]),
            "permutation.S,D",
        )
        manifest = LoadPacketManifest(
            CreatePacketManifest(client_packets=[packet], server_packets=[group[2]])
        )
        self.assertEqual([value.tag for value in manifest["client_packets"]], ["m"])
        self.assertEqual(
            [value.tag for value in manifest["server_packets"]], ["movement.move"]
        )
        self.assertFalse(ValidatePacketSchema([packet])["errors"])
        with self.assertRaisesRegex(ValueError, "duplicate packet tag"):
            AssertPacketSchema([packet, packet])


if __name__ == "__main__":
    unittest.main()
