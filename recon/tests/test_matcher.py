"""Tests for the pure-function matching logic.

Every test follows the same shape: construct two lists, call find_mismatches,
assert what comes out. No fixtures, no mocks, no I/O.
"""

from decimal import Decimal

from recon.matcher import (
    GatewayRecord,
    InternalRecord,
    Mismatch,
    find_mismatches,
)


def _internal(payment_id: str, amount: str, currency: str = "EUR") -> InternalRecord:
    return InternalRecord(payment_id=payment_id, amount=Decimal(amount), currency=currency)


def _gateway(payment_id: str, amount: str, currency: str = "EUR") -> GatewayRecord:
    return GatewayRecord(payment_id=payment_id, amount=Decimal(amount), currency=currency)


def test_empty_inputs_produce_no_findings():
    findings = list(find_mismatches([], []))
    assert findings == []


def test_perfect_match_produces_no_findings():
    internal = [_internal("p1", "10.00"), _internal("p2", "20.00")]
    gateway = [_gateway("p1", "10.00"), _gateway("p2", "20.00")]
    findings = list(find_mismatches(internal, gateway))
    assert findings == []


def test_missing_internal_detected():
    internal: list[InternalRecord] = []
    gateway = [_gateway("p1", "10.00")]
    findings = list(find_mismatches(internal, gateway))
    assert findings == [
        Mismatch(
            kind="missing_internal",
            payment_id="p1",
            gateway_amount=Decimal("10.00"),
            currency="EUR",
        )
    ]


def test_missing_at_gateway_detected():
    internal = [_internal("p1", "10.00")]
    gateway: list[GatewayRecord] = []
    findings = list(find_mismatches(internal, gateway))
    assert findings == [
        Mismatch(
            kind="missing_at_gateway",
            payment_id="p1",
            internal_amount=Decimal("10.00"),
            currency="EUR",
        )
    ]


def test_amount_mismatch_detected():
    internal = [_internal("p1", "10.00")]
    gateway = [_gateway("p1", "9.50")]
    findings = list(find_mismatches(internal, gateway))
    assert findings == [
        Mismatch(
            kind="amount_mismatch",
            payment_id="p1",
            internal_amount=Decimal("10.00"),
            gateway_amount=Decimal("9.50"),
            currency="EUR",
        )
    ]


def test_mixed_findings_all_classified_correctly():
    internal = [
        _internal("p1", "10.00"),  # perfect match
        _internal("p2", "20.00"),  # amount mismatch
        _internal("p3", "30.00"),  # missing at gateway
    ]
    gateway = [
        _gateway("p1", "10.00"),   # perfect match
        _gateway("p2", "19.50"),   # amount mismatch
        _gateway("p4", "40.00"),   # missing internal
    ]
    findings = list(find_mismatches(internal, gateway))

    # Order isn't guaranteed; sort for comparison
    findings_by_kind = {f.kind: f for f in findings}

    assert set(findings_by_kind.keys()) == {
        "amount_mismatch",
        "missing_internal",
        "missing_at_gateway",
    }
    assert findings_by_kind["amount_mismatch"].payment_id == "p2"
    assert findings_by_kind["missing_internal"].payment_id == "p4"
    assert findings_by_kind["missing_at_gateway"].payment_id == "p3"


def test_decimal_precision_preserved():
    """Amounts with different precision should still compare exactly."""
    internal = [_internal("p1", "10.0000")]
    gateway = [_gateway("p1", "10.00")]
    findings = list(find_mismatches(internal, gateway))
    # Decimal('10.0000') == Decimal('10.00') is True; no finding.
    assert findings == []


def test_decimal_precision_distinguishes_subcent_differences():
    """A 0.01 difference must be flagged."""
    internal = [_internal("p1", "10.00")]
    gateway = [_gateway("p1", "10.01")]
    findings = list(find_mismatches(internal, gateway))
    assert len(findings) == 1
    assert findings[0].kind == "amount_mismatch"


def test_inputs_are_consumed_once():
    """find_mismatches works with generators (single-pass iterables)."""
    def internal_gen():
        yield _internal("p1", "10.00")
        yield _internal("p2", "20.00")

    def gateway_gen():
        yield _gateway("p1", "10.00")
        yield _gateway("p3", "30.00")

    findings = list(find_mismatches(internal_gen(), gateway_gen()))
    findings_by_kind = {f.kind: f for f in findings}
    assert set(findings_by_kind.keys()) == {"missing_at_gateway", "missing_internal"}
