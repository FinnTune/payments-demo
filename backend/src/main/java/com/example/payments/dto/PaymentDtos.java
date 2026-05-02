package com.example.payments.dto;

import com.example.payments.domain.Payment;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/**
 * DTOs for the payments API. Records (Java 14+) are the natural shape:
 * immutable, value-based, with auto-generated constructor / accessors / equals.
 *
 * Kept in a single file because these three records form one tight conceptual
 * cluster (request, response, error) and Java records are small enough that
 * splitting into three files would just be visual noise.
 */
public final class PaymentDtos {

    private PaymentDtos() {
        // Utility-style class; no instances.
    }

    /**
     * Inbound: what the client sends to POST /api/v1/payments.
     * Bean Validation annotations are enforced by Spring before the controller
     * method body runs (via the @Valid annotation on the controller parameter).
     */
    public record CreatePaymentRequest(

            @NotNull
            @DecimalMin(value = "0.01", message = "amount must be at least 0.01")
            @DecimalMax(value = "1000000.00", message = "amount must not exceed 1,000,000")
            BigDecimal amount,

            @NotBlank
            @Pattern(regexp = "^[A-Z]{3}$", message = "currency must be ISO-4217 (e.g. EUR)")
            String currency,

            @NotBlank
            @Size(max = 64)
            String customerId,

            @NotBlank
            @Size(max = 256)
            String paymentMethodToken
    ) {}

    /**
     * Outbound: what the server returns. Notice we expose only the fields the
     * client actually needs, and we serialize the enum as a String.
     */
    public record PaymentResponse(
            UUID id,
            String customerId,
            BigDecimal amount,
            String currency,
            String status,
            String authCode,
            String declineReason,
            Instant createdAt,
            Instant updatedAt
    ) {
        /** Map a domain entity to its outbound representation. */
        public static PaymentResponse from(Payment p) {
            return new PaymentResponse(
                    p.getId(),
                    p.getCustomerId(),
                    p.getAmount(),
                    p.getCurrency(),
                    p.getStatus().name(),
                    p.getAuthCode(),
                    p.getDeclineReason(),
                    p.getCreatedAt(),
                    p.getUpdatedAt()
            );
        }
    }

    /**
     * Outbound: what the server returns on errors. Generic enough to cover
     * validation failures, not-found, and unexpected errors.
     */
    public record ErrorResponse(String code, String message, Instant timestamp) {
        public static ErrorResponse of(String code, String message) {
            return new ErrorResponse(code, message, Instant.now());
        }
    }
}