package com.example.payments.domain;

public enum PaymentStatus {
    PENDING,
    AUTHORIZED,
    CAPTURED,
    DECLINED,
    REFUNDED,
    FAILED
}