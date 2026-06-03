"""Streaming CSV readers for reconciliation inputs.

Reads internal and gateway CSV files lazily — one row at a time — so files
larger than memory can be processed without buffering. The matching logic
is pure (matcher.py); this module is the I/O shell around it.
"""

import csv
from collections.abc import Callable, Iterator, Sequence
from decimal import Decimal
from pathlib import Path

from recon.matcher import GatewayRecord, InternalRecord


class CsvFormatError(ValueError):
    """Raised when a CSV row is missing required columns or has malformed data."""


def read_internal_csv(path: Path) -> Iterator[InternalRecord]:
    """Stream InternalRecords from a CSV file.

    Expected columns (header row required): payment_id, amount, currency.
    Extra columns are ignored. Missing required columns raise CsvFormatError.
    Each yielded record is fully validated; a malformed row raises immediately
    (no silent skipping — bad data is an alert-worthy event).
    """
    yield from _read_csv(path, _row_to_internal)


def read_gateway_csv(path: Path) -> Iterator[GatewayRecord]:
    """Stream GatewayRecords from a CSV file. Same format as internal CSVs."""
    yield from _read_csv(path, _row_to_gateway)


def _read_csv[T](
    path: Path,
    row_mapper: Callable[[dict[str, str]], T],
) -> Iterator[T]:
    """Generic CSV streaming with a per-row mapper."""
    with path.open(newline="") as f:
        reader = csv.DictReader(f)
        _require_columns(reader.fieldnames, path)
        for row_num, row in enumerate(reader, start=2):
            try:
                yield row_mapper(row)
            except (KeyError, ValueError, ArithmeticError) as e:
                raise CsvFormatError(
                    f"{path}: line {row_num}: {e}"
                ) from e

def _require_columns(fieldnames: Sequence[str] | None, path: Path) -> None:
    required = {"payment_id", "amount", "currency"}
    if fieldnames is None:
        raise CsvFormatError(f"{path}: file is empty or has no header row")
    missing = required - set(fieldnames)
    if missing:
        raise CsvFormatError(
            f"{path}: missing required columns: {sorted(missing)}"
        )


def _row_to_internal(row: dict[str, str]) -> InternalRecord:
    return InternalRecord(
        payment_id=row["payment_id"].strip(),
        amount=Decimal(row["amount"].strip()),
        currency=row["currency"].strip().upper(),
    )


def _row_to_gateway(row: dict[str, str]) -> GatewayRecord:
    return GatewayRecord(
        payment_id=row["payment_id"].strip(),
        amount=Decimal(row["amount"].strip()),
        currency=row["currency"].strip().upper(),
    )
