-- pgcrypto is a Postgres extension. We don't strictly use it today
-- (UUIDs come from the application via java.util.UUID), but it provides
-- gen_random_uuid() which is handy if you ever want DB-side UUID
-- generation. The IF NOT EXISTS makes the statement safe to re-run.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE payments (
    id                  UUID         PRIMARY KEY,
    customer_id         VARCHAR(64)  NOT NULL,
    amount              NUMERIC(18,4) NOT NULL CHECK (amount > 0),
    currency            VARCHAR(3)   NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), -- ISO-4217
    status              VARCHAR(16)  NOT NULL CHECK (status IN
                            ('PENDING','AUTHORIZED','CAPTURED','DECLINED','REFUNDED','FAILED')),
    idempotency_key     VARCHAR(128) NOT NULL,
    auth_code           VARCHAR(64),
    decline_reason      VARCHAR(128),
    version             BIGINT       NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT payments_idempotency_unique UNIQUE (idempotency_key)
);

CREATE INDEX idx_payments_customer_created ON payments (customer_id, created_at DESC);
CREATE INDEX idx_payments_status_created   ON payments (status, created_at);

-- Partial index for the "find stuck payments" sweep query.
-- Only indexes rows in PENDING or AUTHORIZED, so it stays small even
-- when payments has millions of CAPTURED/DECLINED rows.
CREATE INDEX idx_payments_pending
    ON payments (created_at)
    WHERE status IN ('PENDING', 'AUTHORIZED');