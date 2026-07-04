import logging
import time


class PacketLogger:
    """Readable packet logging middleware for clients and server connections."""

    def __init__(self, logger=None, include_values=True):
        self.logger = logger or logging.getLogger("sonic_ws.packets").info
        self.include_values = include_values
        self._sends = {}
        self._receive_sizes = {}

    def onSend_pre(self, tag, values, *_):
        self._sends[tag] = values

    def onSend_post(self, tag, _data, size):
        self._emit("send", tag, self._sends.pop(tag, None), size + 1)

    def onReceive_pre(self, tag, _data, size):
        self._receive_sizes.setdefault(tag, []).append(size + 1)

    def onReceive_post(self, tag, values):
        queue = self._receive_sizes.get(tag, [])
        size = queue.pop(0) if queue else 0
        if not queue:
            self._receive_sizes.pop(tag, None)
        self._emit("receive", tag, values, size)

    def _emit(self, direction, tag, values, size):
        self.logger({
            "direction": direction,
            "tag": tag,
            "values": values if self.include_values else None,
            "bytes": size,
            "timestamp": time.time(),
        })
