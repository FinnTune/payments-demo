package com.example.payments.service;

import com.example.payments.domain.Payment;
import com.example.payments.domain.PaymentStatus;
import com.example.payments.dto.PaymentDtos.CreatePaymentRequest;
import com.example.payments.repository.PaymentRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for PaymentService.
 *
 * Boots the full Spring context (embedded H2, real repository, real
 * MockPaymentGateway). Verifies behavior end-to-end at the service layer.
 *
 * @Transactional on the class rolls back each test's data after it runs,
 * so tests don't pollute each other.
 */
@SpringBootTest
@Transactional
class PaymentServiceTest {

    @Autowired PaymentService service;
    @Autowired PaymentRepository repo;

    private CreatePaymentRequest request(String tokenSuffix) {
        return new CreatePaymentRequest(
                new BigDecimal("12.50"),
                "EUR",
                "cust-test",
                "tok_visa" + tokenSuffix
        );
    }

    @Test
    void createIdempotent_authorizes_a_normal_payment() {
        var key = "key-" + UUID.randomUUID();
        Payment p = service.createIdempotent(key, request(""));

        assertThat(p.getId()).isNotNull();
        assertThat(p.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
        assertThat(p.getAuthCode()).startsWith("AUTH-");
        assertThat(p.getAmount()).isEqualByComparingTo("12.50");
        assertThat(p.getCurrency()).isEqualTo("EUR");
    }

    @Test
    void createIdempotent_marks_decline_for_decline_token() {
        var key = "key-" + UUID.randomUUID();
        Payment p = service.createIdempotent(key, request("-decline"));

        assertThat(p.getStatus()).isEqualTo(PaymentStatus.DECLINED);
        assertThat(p.getDeclineReason()).isEqualTo("insufficient_funds");
        assertThat(p.getAuthCode()).isNull();
    }

    @Test
    void createIdempotent_returns_same_payment_for_same_key() {
        var key = "key-" + UUID.randomUUID();
        Payment first  = service.createIdempotent(key, request(""));
        Payment second = service.createIdempotent(key, request(""));

        assertThat(second.getId()).isEqualTo(first.getId());
        assertThat(second.getStatus()).isEqualTo(first.getStatus());
        assertThat(second.getAuthCode()).isEqualTo(first.getAuthCode());

        // Verify the database has exactly one row, not two.
        assertThat(repo.findByIdempotencyKey(key)).isPresent();
        assertThat(repo.count()).isEqualTo(1);
    }

    @Test
    void createIdempotent_replays_even_for_declined_payment() {
        // The decline isn't an exception; the payment row exists.
        // A retry of the same key should NOT call the gateway again.
        var key = "key-" + UUID.randomUUID();
        Payment first  = service.createIdempotent(key, request("-decline"));
        Payment second = service.createIdempotent(key, request("-decline"));

        assertThat(second.getId()).isEqualTo(first.getId());
        assertThat(second.getStatus()).isEqualTo(PaymentStatus.DECLINED);
    }

    @Test
    void getById_returns_persisted_payment() {
        var key = "key-" + UUID.randomUUID();
        Payment created = service.createIdempotent(key, request(""));

        Payment fetched = service.getById(created.getId());

        assertThat(fetched.getId()).isEqualTo(created.getId());
        assertThat(fetched.getStatus()).isEqualTo(PaymentStatus.AUTHORIZED);
    }
}