#!/usr/bin/env python3
"""Repro for finding F-01 of audits/2026-11-08-bff-config-audit.md.

Extracts ThreadBudget from a bff.py snapshot without modifying it and cancels a
waiter in the middle of acquire(). Stdlib only.

Run: python3 audits/evidence/2026-11-08-bff-threadbudget-probe.py /path/to/bff.py
Expected on the audited snapshot (ff3867c): held drifts to -2 while the semaphore
is fully free. Expected after the fix: held = 0, free tokens = 8.
"""
import asyncio
import pathlib
import sys


async def probe(source: str) -> dict:
    start = source.index("class ThreadBudget:")
    end = source.index("BUDGET = ThreadBudget")
    namespace = {"asyncio": asyncio}
    exec(source[start:end], namespace)
    budget = namespace["ThreadBudget"](8)

    await budget.acquire(8)                      # heavy holds everything

    async def waiter():
        await budget.acquire(4)                  # text waits

    task = asyncio.create_task(waiter())
    await asyncio.sleep(0.05)
    budget.release(2)                            # waiter takes 2, blocks on the 3rd
    await asyncio.sleep(0.05)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    mid = {"held": budget.held, "free_tokens": budget._sem._value}
    budget.release(6)                            # heavy returns the rest
    final = {"held": budget.held, "free_tokens": budget._sem._value}
    return {"after_cancel": mid, "after_full_release": final,
            "warmup_gate_blocked": budget.held != 0,
            "expected_after_fix": {"held": 0, "free_tokens": 8}}


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
    result = asyncio.run(probe(source))
    for key, value in result.items():
        print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
