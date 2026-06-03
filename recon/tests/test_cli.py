"""Tests for the CLI."""

import json
from pathlib import Path

import pytest

from recon.cli import main


def _write_csv(tmp_path: Path, name: str, rows: list[tuple[str, str, str]]) -> Path:
    p = tmp_path / name
    lines = ["payment_id,amount,currency"]
    lines.extend(f"{pid},{amount},{ccy}" for pid, amount, ccy in rows)
    p.write_text("\n".join(lines) + "\n")
    return p


def test_no_findings_exits_zero(tmp_path: Path, capsys: pytest.CaptureFixture):
    internal = _write_csv(tmp_path, "internal.csv", [("p1", "10.00", "EUR")])
    gateway  = _write_csv(tmp_path, "gateway.csv",  [("p1", "10.00", "EUR")])

    exit_code = main(["--internal", str(internal), "--gateway", str(gateway)])
    assert exit_code == 0

    output = json.loads(capsys.readouterr().out)
    assert output["summary"]["total_findings"] == 0
    assert output["findings"] == []


def test_findings_exit_one(tmp_path: Path, capsys: pytest.CaptureFixture):
    internal = _write_csv(tmp_path, "internal.csv", [("p1", "10.00", "EUR")])
    gateway  = _write_csv(tmp_path, "gateway.csv",  [("p1", "9.50", "EUR")])

    exit_code = main(["--internal", str(internal), "--gateway", str(gateway)])
    assert exit_code == 1

    output = json.loads(capsys.readouterr().out)
    assert output["summary"]["total_findings"] == 1
    assert output["summary"]["by_kind"] == {"amount_mismatch": 1}
    assert output["findings"][0]["kind"] == "amount_mismatch"
    assert output["findings"][0]["internal_amount"] == "10.00"
    assert output["findings"][0]["gateway_amount"] == "9.50"


def test_malformed_csv_exit_two(tmp_path: Path, capsys: pytest.CaptureFixture):
    bad = tmp_path / "internal.csv"
    bad.write_text("payment_id,amount\np1,10.00\n")     # currency missing
    good = _write_csv(tmp_path, "gateway.csv", [("p1", "10.00", "EUR")])

    exit_code = main(["--internal", str(bad), "--gateway", str(good)])
    assert exit_code == 2

    err = capsys.readouterr().err
    assert "missing required columns" in err


def test_missing_file_exit_two(tmp_path: Path, capsys: pytest.CaptureFixture):
    good = _write_csv(tmp_path, "gateway.csv", [("p1", "10.00", "EUR")])
    nonexistent = tmp_path / "does-not-exist.csv"

    exit_code = main(["--internal", str(nonexistent), "--gateway", str(good)])
    assert exit_code == 2

    err = capsys.readouterr().err
    assert "does-not-exist.csv" in err
