"""Triggerboxd draft-warning pipeline (standalone, manual runs only).

This package is deliberately independent of the Next.js application. It never
writes to the Triggerboxd database and never publishes; it produces private draft
artefacts for human review.
"""

__all__ = ["window", "config", "tmdb", "discover", "store", "report"]
