package com.example.payments.service;

import com.example.payments.domain.Payment;
import com.example.payments.domain.PaymentStatus;
import com.example.payments.dto.PaymentDtos.CreatePaymentRequest;
import com.example.payments.gateway.PaymentGateway;
import com.example.payments.repository.PaymentRepository;
import io.micrometer.core.annotation.Timed;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.retry.annotation.Backoff;
import org.springframework.retry.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.NoSuchElementException;
import java.util.UUID;

/**
 * Core payment service. Responsibilities:
 *  - Idempotency at the database level (unique constraint on idempotency_key).
 *  - Retry transient gateway errors with exponential backoff.
 *  - Emit metrics for every payment outcome.
 *  - Structured logging with correlation context.
 */
@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    private final PaymentRepository repo;
    private final PaymentGateway gateway;
    private final MeterRegistry meterRegistry;

    public PaymentService(PaymentRepository repo, PaymentGateway gateway, MeterRegistry meterRegistry) {
        this.repo = repo;
        this.gateway = gateway;
        this.meterRegistry = meterRegistry;
    }

    /**
     * Create a new payment, or return the existing one if the idempotency key
     * has been seen before. Always returns a Payment in a terminal-or-pending state.
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    @Timed(value = "payments.create", description = "Time to create a payment end-to-end")
    public Payment createIdempotent(String idempotencyKey, CreatePaymentRequest req) {
        return repo.findByIdempotencyKey(idempotencyKey)
                .map(existing -> {
                    log.info("idempotent_replay payment_id={} status={}",
                             existing.getId(), existing.getStatus());
                    meterRegistry.counter("payments.idempotent_replay").increment();
                    return existing;
                })
                .orElseGet(() -> insertAndCharge(idempotencyKey, req));
    }

    private Payment insertAndCharge(String key, CreatePaymentRequest req) {
        Payment payment = new Payment(
                UUID.randomUUID(),
                req.customerId(),
                req.amount(),
                req.currency(),
                PaymentStatus.PENDING,
                key
        );

        // Persist PENDING first so we have a record even if the gateway call fails.
        try {
            payment = repo.saveAndFlush(payment);
        } catch (DataIntegrityViolationException dup) {
            // Concurrent request beat us to the unique key — return the winner.
            log.info("idempotency_race_lost key={}", key);
            return repo.findByIdempotencyKey(key).orElseThrow();
        }

        try {
            String authCode = chargeWithRetry(req.paymentMethodToken(), req.amount(), req.currency());
            payment.markAuthorized(authCode);
            meterRegistry.counter("payments.outcome",
                    "result", "authorized", "currency", req.currency()).increment();
            log.info("payment_authorized payment_id={} amount={} {}",
                     payment.getId(), req.amount(), req.currency());
        } catch (PaymentGateway.DeclinedException e) {
            payment.markDeclined(e.getReason());
            meterRegistry.counter("payments.outcome",
                    "result", "declined", "reason", e.getReason()).increment();
            log.info("payment_declined payment_id={} reason={}", payment.getId(), e.getReason());
        } catch (PaymentGateway.TransientException e) {
            // Retries exhausted — mark FAILED so an operator can investigate.
            payment.markFailed("gateway_unavailable");
            meterRegistry.counter("payments.outcome",
                    "result", "failed", "reason", "gateway_unavailable").increment();
            log.error("payment_failed payment_id={} cause={}",
                      payment.getId(), e.getMessage(), e);
        }

        return repo.save(payment);
    }

    @Retryable(
            retryFor = PaymentGateway.TransientException.class,
            maxAttempts = 3,
            backoff = @Backoff(delay = 200, multiplier = 2.0, maxDelay = 2000)
    )
    String chargeWithRetry(String token, BigDecimal amount, String currency) {
        return gateway.authorize(token, amount, currency);
    }

    @Transactional(readOnly = true)
    public Payment getById(UUID id) {
        return repo.findById(id)
                .orElseThrow(() -> new NoSuchElementException("Payment not found: " + id));
    }

    @Transactional
    public Payment capture(UUID id) {
        Payment p = getById(id);
        gateway.capture(p.getAuthCode());
        p.markCaptured();
        meterRegistry.counter("payments.captured").increment();
        return repo.save(p);
    }
}