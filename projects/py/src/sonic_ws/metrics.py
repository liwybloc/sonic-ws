from copy import deepcopy
from dataclasses import dataclass, asdict


@dataclass
class PacketMetric:
    packets: int = 0
    bytes: int = 0


class SonicMetrics:
    """Collects production-safe counters from SonicWS middleware hooks."""

    def __init__(self):
        self.sent = {}
        self.received = {}
        self.broadcasts = {}
        self.closes = {}
        self.send_errors = {}
        self.volatile_drops = {}

    def onSend_post(self, tag, _data, size):
        self._add_metric(self.sent, tag, size + 1)

    def onReceive_pre(self, tag, _data, size):
        self._add_metric(self.received, tag, size + 1)

    def onPacketBroadcast_post(self, tag, _info, _data, size):
        self._add_metric(self.broadcasts, tag, size + 1)

    def onClientDisconnect(self, _connection, code, _reason=None):
        self._add_count(self.closes, str(code))

    def record_send_error(self, packet_tag):
        """Records a send error from an on_send_error callback."""

        self._add_count(self.send_errors, packet_tag)

    def recordSendError(self, packet_tag):
        self.record_send_error(packet_tag)

    def record_volatile_drop(self, packet_tag):
        """Records a volatile send skipped because of backpressure."""

        self._add_count(self.volatile_drops, packet_tag)

    def recordVolatileDrop(self, packet_tag):
        self.record_volatile_drop(packet_tag)

    def snapshot(self):
        """Returns a copy of the current counters."""

        return {
            "sent": self._metric_snapshot(self.sent),
            "received": self._metric_snapshot(self.received),
            "broadcasts": self._metric_snapshot(self.broadcasts),
            "closes": deepcopy(self.closes),
            "sendErrors": deepcopy(self.send_errors),
            "send_errors": deepcopy(self.send_errors),
            "volatileDrops": deepcopy(self.volatile_drops),
            "volatile_drops": deepcopy(self.volatile_drops),
        }

    def reset(self):
        """Clears all counters."""

        self.sent.clear()
        self.received.clear()
        self.broadcasts.clear()
        self.closes.clear()
        self.send_errors.clear()
        self.volatile_drops.clear()

    @staticmethod
    def _add_metric(target, tag, size):
        metric = target.setdefault(tag, PacketMetric())
        metric.packets += 1
        metric.bytes += size

    @staticmethod
    def _add_count(target, key):
        target[key] = target.get(key, 0) + 1

    @staticmethod
    def _metric_snapshot(source):
        return {key: asdict(value) for key, value in source.items()}

