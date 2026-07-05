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

import asyncio
import inspect
import logging
import time
from collections import defaultdict
from collections import deque
from enum import IntEnum
from typing import Any, Callable
from .codec import encode_batch, decode_batch
from .packets import Packet, flatten_data
from .schema_validation import assert_packet_schema
from .variant_permutation import VariantPermutation

logger = logging.getLogger(__name__)


class CloseCodes(IntEnum):
    RATELIMIT = 4000
    SMALL = 4001
    INVALID_KEY = 4002
    INVALID_PACKET = 4003
    INVALID_DATA = 4004
    REPEATED_HANDSHAKE = 4005
    DISABLED_PACKET = 4006
    MIDDLEWARE = 4007
    MANUAL_SHUTDOWN = 4008
    BACKPRESSURE = 4009


def get_closure_cause(code):
    if code >= 4000:
        try:
            return CloseCodes(code).name
        except ValueError:
            return "UNKNOWN"
    return {
        1000: "NORMAL_CLOSURE",
        1001: "GOING_AWAY",
        1002: "PROTOCOL_ERROR",
        1003: "UNSUPPORTED_DATA",
        1006: "ABNORMAL_CLOSURE",
    }.get(code, "UNKNOWN")


getClosureCause = get_closure_cause


async def _call(callback, *args):
    result = callback(*args)
    if inspect.isawaitable(result):
        return await result
    return result


class PacketHolder:
    def __init__(self, packets=()):
        self.hold_packets(packets)

    def hold_packets(self, packets):
        self.packets = list(packets)
        assert_packet_schema(self.packets)
        self.by_tag = {p.tag: p for p in self.packets}
        self.tags = [p.tag for p in self.packets]
        self.variants = {
            f"{p.parent}.{p.variant}": p.tag
            for p in self.packets
            if p.parent and p.variant
        }
        self.parents = {p.parent for p in self.packets if p.parent}
        if len(self.packets) > 254:
            raise ValueError("SonicWS supports at most 254 packets per direction")

    def serialize(self):
        return b"".join(packet.serialize() for packet in self.packets)

    def code(self, tag):
        tag = self.resolve(tag)
        try:
            return self.tags.index(tag) + 1
        except ValueError as exc:
            raise ValueError(f"Unknown packet {tag!r}") from exc

    def tag(self, code):
        if code == 0:
            raise ValueError("packet key 0 is reserved")
        return self.tags[code - 1]

    def packet(self, tag):
        return self.by_tag[self.resolve(tag)]

    def __contains__(self, tag):
        return self.resolve(tag) in self.by_tag or tag in self.parents

    def resolve(self, tag):
        return self.variants.get(tag, tag)

    def variant_tag(self, parent, variant):
        try:
            return self.variants[f"{parent}.{variant}"]
        except KeyError as error:
            raise ValueError(f"Unknown packet variant: {parent}.{variant}") from error

    def permutation_tag(self, parent, selection):
        packet = self.packet(parent)
        if packet.permutation_values is None:
            raise ValueError(f'Packet group "{parent}" does not define a VariantPermutation')
        permutation = VariantPermutation(packet.permutation_values)
        variant = permutation.resolve(selection)
        return parent if not variant else self.variant_tag(parent, variant)


class Connection:
    def __init__(self, socket, identifier=-1, name="LocalSocket"):
        self.socket = socket
        self.id = identifier
        self._name = name
        self._listeners = defaultdict(list)
        self._middlewares = []
        self._tasks = set()
        self._close_callbacks = {}
        self._closed = False
        self._batch_data = defaultdict(list)
        self._batch_tasks = {}
        self._rate_windows = defaultdict(deque)
        self._async_packet_locks = defaultdict(asyncio.Lock)
        self._send_lock = asyncio.Lock()
        self.state = {}
        self._volatile_at_bytes = 1 * 1024 * 1024
        self._close_at_bytes = 16 * 1024 * 1024

    def _within_rate(self, key, limit):
        if not limit or limit < 0:
            return True
        now = time.monotonic()
        window = self._rate_windows[key]
        while window and now - window[0] >= 1:
            window.popleft()
        if len(window) >= limit:
            return False
        window.append(now)
        return True

    def add_middleware(self, middleware):
        self._middlewares.append(middleware)
        callback = getattr(middleware, "init", None)
        if callback:
            try:
                result = callback(self)
                if inspect.isawaitable(result):
                    task = asyncio.create_task(result)
                    self._tasks.add(task)
                    task.add_done_callback(self._tasks.discard)
            except Exception:
                logger.exception("Middleware init raised an exception")

    async def _middleware(self, name, *args):
        cancelled = False
        for middleware in self._middlewares:
            callback = getattr(middleware, name, None)
            if callback:
                try:
                    if await _call(callback, *args):
                        cancelled = True
                except Exception:
                    logger.exception("Middleware %s raised an exception", name)
        return cancelled

    async def call_middleware(self, name, *args):
        return await self._middleware(name, *args)

    def on(self, tag, listener):
        self._listeners[tag].append(listener)
        return self

    def off(self, tag, listener):
        listeners = self._listeners.get(tag, [])
        if listener in listeners:
            listeners.remove(listener)
        return self

    def on_close(self, listener):
        return self.on("__close__", listener)

    async def _emit(self, tag, values, spread=True):
        for callback in tuple(self._listeners.get(tag, ())):
            await _call(
                callback, *(values if spread and isinstance(values, list) else [values])
            )

    async def raw_send(self, data):
        if self.get_buffered_amount() >= self._close_at_bytes:
            await self.close(
                CloseCodes.BACKPRESSURE, "outbound buffer exceeded the configured limit"
            )
            raise RuntimeError("SonicWS outbound backpressure limit exceeded")
        raw = bytes(data)
        await self.socket.send(raw)
        await self._emit("__raw_send__", raw, False)

    def get_buffered_amount(self):
        transport = getattr(self.socket, "transport", None)
        getter = getattr(transport, "get_write_buffer_size", None)
        return int(getter()) if getter else 0

    def set_backpressure_limits(self, *, volatile_at_bytes=None, close_at_bytes=None):
        volatile = (
            self._volatile_at_bytes
            if volatile_at_bytes is None
            else int(volatile_at_bytes)
        )
        close = self._close_at_bytes if close_at_bytes is None else int(close_at_bytes)
        if volatile < 0 or close <= 0 or volatile > close:
            raise ValueError("invalid SonicWS backpressure limits")
        self._volatile_at_bytes, self._close_at_bytes = volatile, close

    def can_send_volatile(self):
        return self.get_buffered_amount() < self._volatile_at_bytes

    def raw_onmessage(self, listener):
        return self.on("__raw_message__", listener)

    def raw_onsend(self, listener):
        return self.on("__raw_send__", listener)

    async def close(self, code=1000, reason=""):
        self._closed = True
        await self.socket.close(code=code, reason=reason)

    def is_closed(self):
        return self._closed or self.socket.state.name == "CLOSED"

    async def set_name(self, name):
        if not await self._middleware("onNameChange", name):
            self._name = name

    def get_name(self):
        return self._name

    def set_timeout(self, callback, milliseconds, call_on_close=False):
        async def run():
            await asyncio.sleep(milliseconds / 1000)
            await _call(callback)

        task = asyncio.create_task(run())
        if call_on_close:
            self._close_callbacks[task] = callback
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def set_interval(self, callback, milliseconds, call_on_close=False):
        async def run():
            while not self._closed:
                await asyncio.sleep(milliseconds / 1000)
                await _call(callback)

        task = asyncio.create_task(run())
        if call_on_close:
            self._close_callbacks[task] = callback
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def _task_done(self, task):
        self._tasks.discard(task)
        self._close_callbacks.pop(task, None)

    def clear_timeout(self, task):
        task.cancel()
        self._tasks.discard(task)
        self._close_callbacks.pop(task, None)

    clear_interval = clear_timeout

    async def _batch(self, code, packet, data):
        self._batch_data[code].append(data)
        if code in self._batch_tasks:
            return

        async def flush():
            await asyncio.sleep(packet.data_batching / 1000)
            payloads = self._batch_data.pop(code, [])
            self._batch_tasks.pop(code, None)
            if payloads:
                await self.raw_send(
                    bytes([code]) + encode_batch(payloads, packet.gzip_compression)
                )

        self._batch_tasks[code] = asyncio.create_task(flush())

    async def _shutdown(self, code=1000, reason=""):
        self._closed = True
        for task in tuple(self._tasks):
            task.cancel()
            callback = self._close_callbacks.pop(task, None)
            if callback:
                try:
                    await _call(callback, True)
                except TypeError:
                    await _call(callback)
        await self._middleware("onStatusChange", 3)
        await self._emit("__close__", [code, reason])

    addMiddleware = add_middleware
    callMiddleware = call_middleware
    rawSend = raw_send
    raw_onMessage = raw_onmessage
    raw_onSend = raw_onsend
    isClosed = is_closed
    setName = set_name
    getName = get_name
    setTimeout = set_timeout
    setInterval = set_interval
    clearTimeout = clear_timeout
    clearInterval = clear_interval
    getBufferedAmount = get_buffered_amount
    setBackpressureLimits = set_backpressure_limits


async def dispatch_packet(connection, packet, payload, socket_for_validator=None):
    if connection._closed:
        return
    async with connection._async_packet_locks[packet.tag]:
        cache_key = connection.id
        if packet.rereference and not payload:
            if cache_key not in packet.last_received:
                raise ValueError("no previous value to rereference")
            values = packet.last_received[cache_key]
            await connection._emit(
                packet.tag, values, bool(not packet.dont_spread and not packet.schema)
            )
            if packet.parent and packet.variant:
                await connection._emit(
                    f"{packet.parent}.{packet.variant}", values, False
                )
                event = {"variant": packet.variant, "payload": values}
                if packet.permutation() is not None:
                    event["permutation"] = packet.permutation()
                await connection._emit(packet.parent, event, False)
            return
        payloads = (
            decode_batch(payload, packet.gzip_compression, packet.max_batch_size)
            if packet.data_batching
            else [payload]
        )
        for item in payloads:
            if connection._closed:
                return
            values = packet.decode(item)
            if packet.rereference:
                packet.last_received[cache_key] = values
            if packet.validator:
                args = (
                    values
                    if isinstance(values, list)
                    and not packet.dont_spread
                    and not packet.schema
                    else [values]
                )
                if not await _call(packet.validator, socket_for_validator, *args):
                    raise ValueError("custom packet validation failed")
            await connection._emit(
                packet.tag, values, bool(not packet.dont_spread and not packet.schema)
            )
            if packet.parent and packet.variant:
                await connection._emit(
                    f"{packet.parent}.{packet.variant}", values, False
                )
                event = {"variant": packet.variant, "payload": values}
                if packet.permutation() is not None:
                    event["permutation"] = packet.permutation()
                await connection._emit(packet.parent, event, False)
            await connection._middleware("onReceive_post", packet.tag, values)
