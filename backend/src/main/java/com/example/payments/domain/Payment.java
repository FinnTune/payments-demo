package com.example.payments.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "payments")
public class Payment {

    @Id
    @Column(columnDefinition = "uuid")
    private UUID id;

    @Column(name = "customer_id", nullable = false)
    private String customerId;

    @Column(nullable = false, precision = 18, scale = 4)
    private BigDecimal amount;

    @Column(nullable = false, length = 3)
    private String currency;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PaymentStatus status;

    @Column(name = "idempotency_key", nullable = false, unique = true)
    private String idempotencyKey;

    @Column(name = "auth_code")
    private String authCode;

    @Column(name = "decline_reason")
    private String declineReason;

    @Version
    private long version;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected Payment() { /* required by JPA */ }

    public Payment(UUID id, String customerId, BigDecimal amount, String currency,
                   PaymentStatus status, String idempotencyKey) {
        this.id = id;
        this.customerId = customerId;
        this.amount = amount;
        this.currency = currency;
        this.status = status;
        this.idempotencyKey = idempotencyKey;
    }

    // --- Domain methods: state transitions go through here ---

    public void markAuthorized(String authCode) {
        this.status = PaymentStatus.AUTHORIZED;
        this.authCode = authCode;
        this.declineReason = null;
    }

    public void markCaptured() {
        if (this.status != PaymentStatus.AUTHORIZED) {
            throw new IllegalStateException("Cannot capture payment in status: " + this.status);
        }
        this.status = PaymentStatus.CAPTURED;
    }

    public void markDeclined(String reason) {
        this.status = PaymentStatus.DECLINED;
        this.declineReason = reason;
    }

    public void markFailed(String reason) {
        this.status = PaymentStatus.FAILED;
        this.declineReason = reason;
    }

    // --- Getters: no setters by design ---

    public UUID getId() { return id; }
    public String getCustomerId() { return customerId; }
    public BigDecimal getAmount() { return amount; }
    public String getCurrency() { return currency; }
    public PaymentStatus getStatus() { return status; }
    public String getIdempotencyKey() { return idempotencyKey; }
    public String getAuthCode() { return authCode; }
    public String getDeclineReason() { return declineReason; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public long getVersion() { return version; }
}