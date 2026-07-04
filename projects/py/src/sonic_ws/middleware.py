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

"""Middleware base classes shared by the Python client and server.

Methods are intentionally optional: applications can subclass these types for
discoverability, or pass any object implementing the documented hooks.
"""


class BasicMiddleware:
    """Base middleware. ``init(holder)`` is called when it is installed."""

    def init(self, holder):
        pass


class ConnectionMiddleware(BasicMiddleware):
    """Hooks for one client or server-side connection."""


class ServerMiddleware(BasicMiddleware):
    """Hooks for server-wide connection and broadcast events."""


class BCInfo(dict):
    """Broadcast metadata with both mapping and attribute access."""

    __getattr__ = dict.__getitem__
