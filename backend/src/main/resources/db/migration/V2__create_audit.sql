-- Append-only audit log of every payment state change.
CREATE TABLE payment_events (
    id              BIGSERIAL    PRIMARY KEY,
    payment_id      UUID         NOT NULL REFERENCES payments(id),
    event_type      VARCHAR(32)  NOT NULL,
    from_status     VARCHAR(16),
    to_status       VARCHAR(16)  NOT NULL,
    actor           VARCHAR(128),
    metadata        JSONB,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_events_payment ON payment_events (payment_id, occurred_at);

-- Trigger function: append a row to payment_events on every payments
-- INSERT or status UPDATE. Means the application can't accidentally
-- forget to audit a transition — the database enforces it.
CREATE OR REPLACE FUNCTION trg_payment_status_change() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO payment_events (payment_id, event_type, from_status, to_status, metadata)
        VALUES (NEW.id, 'CREATED', NULL, NEW.status,
                jsonb_build_object('amount', NEW.amount, 'currency', NEW.currency));
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO payment_events (payment_id, event_type, from_status, to_status, metadata)
        VALUES (NEW.id, 'STATUS_CHANGED', OLD.status, NEW.status,
                jsonb_build_object('auth_code', NEW.auth_code, 'decline_reason', NEW.decline_reason));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_audit_trigger
AFTER INSERT OR UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION trg_payment_status_change();