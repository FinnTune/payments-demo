package com.example.payments.controller;

import com.example.payments.domain.Payment;
import com.example.payments.dto.PaymentDtos.CreatePaymentRequest;
import com.example.payments.dto.PaymentDtos.PaymentResponse;
import com.example.payments.service.PaymentService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.UUID;

/**
 * REST API for payments.
 *
 *   POST   /api/v1/payments              Create (Idempotency-Key header required)
 *   GET    /api/v1/payments/{id}         Read
 *   POST   /api/v1/payments/{id}/capture Capture an authorized payment
 *
 * Authorization is enforced per-method via @PreAuthorize. Scopes
 * (payments:write, payments:read) come from the JWT issued by the
 * OAuth2 issuer (Cognito in production).
 */
@RestController
@RequestMapping("/api/v1/payments")
@Validated
public class PaymentController {

    private static final Logger log = LoggerFactory.getLogger(PaymentController.class);

    private final PaymentService service;

    public PaymentController(PaymentService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('SCOPE_payments:write')")
    public ResponseEntity<PaymentResponse> create(
            @RequestHeader("Idempotency-Key") @NotBlank String idempotencyKey,
            @Valid @RequestBody CreatePaymentRequest request,
            UriComponentsBuilder uriBuilder) {

        MDC.put("idempotencyKey", idempotencyKey);
        try {
            log.info("create_payment_request currency={} customerId={}",
                     request.currency(), request.customerId());

            Payment payment = service.createIdempotent(idempotencyKey, request);

            var location = uriBuilder
                    .path("/api/v1/payments/{id}")
                    .buildAndExpand(payment.getId())
                    .toUri();

            return ResponseEntity.created(location).body(PaymentResponse.from(payment));
        } finally {
            MDC.remove("idempotencyKey");
        }
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('SCOPE_payments:read')")
    public PaymentResponse get(@PathVariable UUID id) {
        return PaymentResponse.from(service.getById(id));
    }

    @PostMapping("/{id}/capture")
    @PreAuthorize("hasAuthority('SCOPE_payments:write')")
    public PaymentResponse capture(@PathVariable UUID id) {
        return PaymentResponse.from(service.capture(id));
    }
}