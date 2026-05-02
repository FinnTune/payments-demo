package com.example.payments.gateway;

import java.math.BigDecimal;

/**
 * Abstraction over an external card-acquiring gateway (Stripe, Adyen, Worldline, etc.).
 *
 * Implementations are responsible for authorizing and capturing a payment given a
 * tokenized payment method. The token MUST come from a PCI-compliant vault — raw
 * card data never enters this system.
 */
public interface PaymentGateway {

    /**
     * Authorize a charge. Returns an opaque authorization code on success.
     *
     * @throws DeclinedException   if the issuer declined (e.g. insufficient funds, fraud).
     *                             Do NOT retry; the answer won't change.
     * @throws TransientException  if the call failed for a recoverable reason
     *                             (network blip, gateway 5xx). Caller may retry.
     */
    String authorize(String paymentMethodToken, BigDecimal amount, String currency);

    /**
     * Capture a previously authorized charge. Idempotent on authCode.
     */
    void capture(String authCode);

    /** Issuer/processor declined; do NOT retry. */
    class DeclinedException extends RuntimeException {
        private final String reason;

        public DeclinedException(String reason) {
            super("declined: " + reason);
            this.reason = reason;
        }

        public String getReason() {
            return reason;
        }
    }

    /** Transient failure; safe to retry. */
    class TransientException extends RuntimeException {
        public TransientException(String msg, Throwable cause) {
            super(msg, cause);
        }
    }
}