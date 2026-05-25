package com.example.payments.exception;

import java.util.UUID;

/**
 * Thrown when a Payment lookup by id returns nothing.
 * Mapped to HTTP 404 by GlobalExceptionHandler.
 */
public class PaymentNotFoundException extends RuntimeException {
    public PaymentNotFoundException(UUID id) {
        super("Payment not found: " + id);
    }
}