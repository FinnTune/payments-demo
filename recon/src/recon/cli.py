"""Command-line entry point for the reconciliation job.

Usage:
    recon --internal path/to/internal.csv --gateway path/to/gateway.csv

Reads two CSV files, runs find_mismatches, writes findings as JSON to
stdout. Exit code 0 if no mismatches; 1 if any mismatches; 2 on
malformed input.
"""

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

from recon.io import CsvFormatError, read_gateway_csv, read_internal_csv
from recon.matcher import Mismatch, find_mismatches


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="recon",
        description="Reconcile internal payment records against gateway settlement files.",
    )
    parser.add_argument("--internal", type=Path, required=True, help="Internal records CSV")
    parser.add_argument("--gateway", type=Path, required=True, help="Gateway settlement CSV")
    args = parser.parse_args(argv)

    try:
        internal = read_internal_csv(args.internal)
        gateway = read_gateway_csv(args.gateway)
        findings = list(find_mismatches(internal, gateway))
    except CsvFormatError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2
    except FileNotFoundError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    output = {
        "summary": {
            "total_findings": len(findings),
            "by_kind": _count_by_kind(findings),
        },
        "findings": [_finding_to_dict(f) for f in findings],
    }
    json.dump(output, sys.stdout, indent=2, default=_json_default)
    sys.stdout.write("\n")

    return 1 if findings else 0


def _count_by_kind(findings: list[Mismatch]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for f in findings:
        counts[f.kind] = counts.get(f.kind, 0) + 1
    return counts


def _finding_to_dict(f: Mismatch) -> dict[str, object]:
    """Convert a Mismatch to a JSON-serializable dict, omitting None fields."""
    d: dict[str, object] = {"kind": f.kind, "payment_id": f.payment_id}
    if f.internal_amount is not None:
        d["internal_amount"] = f.internal_amount
    if f.gateway_amount is not None:
        d["gateway_amount"] = f.gateway_amount
    if f.currency is not None:
        d["currency"] = f.currency
    return d


def _json_default(obj: object) -> str:
    """json.dump doesn't know how to serialize Decimal; convert to string."""
    if isinstance(obj, Decimal):
        return str(obj)
    raise TypeError(f"Not JSON-serializable: {type(obj).__name__}")


if __name__ == "__main__":
    sys.exit(main())
