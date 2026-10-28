"""Command-line entrypoint: parse flags, run builders in a fixed order, guard, and write the bundle."""

from __future__ import annotations

import argparse
from pathlib import Path

from . import config, scenarios
from .bundle import Bundle, GuardError
from .gen import Gen


def _build_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="generate.py",
        description="Generate a synthetic (fake) JKN evidence bundle. Synthetic data only.",
    )
    p.add_argument("--episodes", type=int, default=60, help="total episodes to emit (default: 60)")
    p.add_argument("--seed-fraud", action="store_true", help="include the seeded fraud + exception families")
    p.add_argument("--seed", type=int, default=42, help="RNG/Faker seed; fixed → reproducible (default: 42)")
    p.add_argument("--out", type=Path, default=Path("out"), help="output directory (wiped first; default: ./out)")
    p.add_argument("--quiet", action="store_true", help="suppress the summary line")
    args = p.parse_args(argv)
    if args.episodes < 1:
        p.error("--episodes must be >= 1")
    if args.seed_fraud and args.episodes < config.MIN_EPISODES:
        p.error(f"--seed-fraud needs --episodes >= {config.MIN_EPISODES} to fit all five families")
    return args


def _generate(args: argparse.Namespace) -> dict:
    gen = Gen.create(args.seed)
    bundle = Bundle(seed=args.seed, seed_fraud=args.seed_fraud, requested_episodes=args.episodes)

    k = round(args.episodes * config.SEED_RATIO) if args.seed_fraud else 0
    n_clean = args.episodes - 5 * k

    # Fixed build order → deterministic refs.
    for _ in range(n_clean):
        scenarios.build_clean(bundle, gen)
    if args.seed_fraud:
        for _ in range(k):
            scenarios.build_repeat_billing(bundle, gen)
        scenarios.build_cloning(bundle, gen, k, "clone_01")
        for _ in range(k):
            scenarios.build_contradiction(bundle, gen)
        for _ in range(k):
            scenarios.build_exception_repeatable(bundle, gen)
        scenarios.build_exception_soap(bundle, gen, k, "soap_01")

    return bundle.write(args.out)


def main(argv: list[str] | None = None) -> int:
    args = _build_args(argv)
    try:
        counts = _generate(args)
    except GuardError as exc:
        print(f"GUARD FAILED — nothing written: {exc}")
        return 1
    if not args.quiet:
        cats = ", ".join(f"{k}={v}" for k, v in counts["byCategory"].items())
        print(
            f"Wrote {counts['episodes']} episodes / {counts['claimVersions']} claims / "
            f"{counts['evidenceRecords']} evidence ({counts['files']} files) to {args.out}/"
        )
        print(f"  categories: {cats}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
