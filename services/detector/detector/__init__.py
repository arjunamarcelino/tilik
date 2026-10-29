"""Tilik detector worker — polls the transactional outbox and runs fraud detectors.

Prompt 07 ships the reliable loop + a byte-identical patient tokenizer + a no-op detector stub.
The actual detectors (repeat-billing, cloning, pertentangan-bukti) land in Prompts 08–09.
"""

from __future__ import annotations

__version__ = "0.1.0"
