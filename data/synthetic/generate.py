#!/usr/bin/env python3
"""Thin entrypoint so `python generate.py ...` works; all logic lives in tilik_synth.cli."""

from tilik_synth.cli import main

if __name__ == "__main__":
    raise SystemExit(main())
