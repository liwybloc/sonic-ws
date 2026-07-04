import unittest

from sonic_ws.control import decode_control
from sonic_ws.server import SonicWSServer


class SecurityTests(unittest.TestCase):
    def test_malformed_control_frames(self):
        for value in (b"", b"\x00\x63\x00", b"\x00\x01\x00", b"\x00\x01" + b"\x80" * 8):
            with self.subTest(value=value), self.assertRaises(ValueError):
                decode_control(value)

    def test_replay_buffer_is_bounded(self):
        server = SonicWSServer(recovery={"max_packets": 3})
        session_id = "test-session"
        server.sessions[session_id] = {
            "state": {},
            "rooms": set(),
            "sequence": 0,
            "frames": [],
            "expires": float("inf"),
        }
        connection = type("Connection", (), {"session_id": session_id})()
        for value in range(10):
            server.replay_frame(connection, bytes([1, value]))
        self.assertEqual(len(server.sessions[session_id]["frames"]), 3)
        self.assertEqual(
            [sequence for sequence, _ in server.sessions[session_id]["frames"]],
            [8, 9, 10],
        )


if __name__ == "__main__":
    unittest.main()
