"""Tests for the CSV streaming readers."""

from decimal import Decimal
from pathlib import Path

import pytest

from recon.io import CsvFormatError, read_gateway_csv, read_internal_csv
from recon.matcher import GatewayRecord, InternalRecord


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content)
    return p


def test_read_internal_csv_happy_path(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount,currency\n"
        "p1,10.00,EUR\n"
        "p2,20.50,USD\n",
    )
    records = list(read_internal_csv(csv_path))
    assert records == [
        InternalRecord(payment_id="p1", amount=Decimal("10.00"), currency="EUR"),
        InternalRecord(payment_id="p2", amount=Decimal("20.50"), currency="USD"),
    ]


def test_read_gateway_csv_happy_path(tmp_path: Path):
    csv_path = _write(
        tmp_path, "gateway.csv",
        "payment_id,amount,currency\n"
        "p1,10.00,EUR\n",
    )
    records = list(read_gateway_csv(csv_path))
    assert records == [
        GatewayRecord(payment_id="p1", amount=Decimal("10.00"), currency="EUR"),
    ]


def test_extra_columns_ignored(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount,currency,fee,timestamp\n"
        "p1,10.00,EUR,0.30,2024-01-01\n",
    )
    records = list(read_internal_csv(csv_path))
    assert len(records) == 1
    assert records[0].payment_id == "p1"


def test_missing_required_column_raises(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount\n"      # currency missing
        "p1,10.00\n",
    )
    with pytest.raises(CsvFormatError, match=r"missing required columns.*currency"):
        list(read_internal_csv(csv_path))


def test_malformed_amount_raises_with_line_number(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount,currency\n"
        "p1,10.00,EUR\n"
        "p2,not-a-number,EUR\n",
    )
    with pytest.raises(CsvFormatError, match="line 3"):
        list(read_internal_csv(csv_path))


def test_whitespace_stripped(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount,currency\n"
        " p1 , 10.00 , eur \n",
    )
    records = list(read_internal_csv(csv_path))
    assert records[0].payment_id == "p1"
    assert records[0].currency == "EUR"          # uppercased
    assert records[0].amount == Decimal("10.00")


def test_empty_file_raises(tmp_path: Path):
    csv_path = _write(tmp_path, "internal.csv", "")
    with pytest.raises(CsvFormatError, match="empty or has no header"):
        list(read_internal_csv(csv_path))


def test_header_only_no_data_rows_ok(tmp_path: Path):
    csv_path = _write(
        tmp_path, "internal.csv",
        "payment_id,amount,currency\n",
    )
    records = list(read_internal_csv(csv_path))
    assert records == []
