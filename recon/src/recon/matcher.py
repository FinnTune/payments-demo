"""Pure-function matching logic for reconciliation.

Given an iterable of internal records and an iterable of gateway records,
yields findings describing discrepancies. No I/O, no global state — just
in, findings out.
"""

from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class InternalRecord:
    """A payment as recorded in our system."""
    payment_id: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class GatewayRecord:
    """A payment as reported by the upstream gateway."""
    payment_id: str
    amount: Decimal
    currency: str


@dataclass(frozen=True)
class Mismatch:
    """A reconciliation finding.

    kind is one of: 'amount_mismatch', 'missing_internal', 'missing_at_gateway'.
    The Optional fields are populated according to kind.
    """
    kind: str
    payment_id: str
    internal_amount: Decimal | None = None
    gateway_amount: Decimal | None = None
    currency: str | None = None


def find_mismatches(
    internal: Iterable[InternalRecord],
    gateway: Iterable[GatewayRecord],
) -> Iterator[Mismatch]:
    """Compare two payment streams and yield findings.

    Three classes of finding:
      - amount_mismatch: present on both sides, amounts differ
      - missing_internal: gateway has it, we don't
      - missing_at_gateway: we have it, gateway doesn't

    Both inputs are consumed once. Order of yielded findings is not specified.
    """
    internal_by_id = {r.payment_id: r for r in internal}
    gateway_by_id = {r.payment_id: r for r in gateway}

    all_ids = internal_by_id.keys() | gateway_by_id.keys()

    for payment_id in all_ids:
        i = internal_by_id.get(payment_id)
        g = gateway_by_id.get(payment_id)

        if i is None and g is not None:
            yield Mismatch(
                kind="missing_internal",
                payment_id=payment_id,
                gateway_amount=g.amount,
                currency=g.currency,
            )
        elif g is None and i is not None:
            yield Mismatch(
                kind="missing_at_gateway",
                payment_id=payment_id,
                internal_amount=i.amount,
                currency=i.currency,
            )
        elif i is not None and g is not None and i.amount != g.amount:
            yield Mismatch(
                kind="amount_mismatch",
                payment_id=payment_id,
                internal_amount=i.amount,
                gateway_amount=g.amount,
                currency=i.currency,
            )
        # else: both present and amounts agree — not a finding
