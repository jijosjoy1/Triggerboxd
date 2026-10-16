"""Subtitle providers.

Every adapter is optional: if a provider is unavailable, unauthorised or its
terms are unclear, the run reports that briefly and continues with whatever is
still eligible. Local file import always remains available.
"""

from __future__ import annotations


class ProviderError(RuntimeError):
    """Base class for provider failures. Messages never contain credentials."""


class ProviderUnavailable(ProviderError):
    """No credential, or the provider refused the request."""


class NoMatch(ProviderError):
    """The provider answered but nothing safe could be selected."""
