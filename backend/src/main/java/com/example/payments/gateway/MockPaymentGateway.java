package com.example.payments.gateway;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.util.UUID;

/**
 * Mock gateway used in local/dev/test profiles. Decline rules are deterministic
 * based on the token suffix so tests can reproduce specific scenarios:
 *
 *   token ending in "-decline"  → DeclinedException("insufficient_funds")
 *   token ending in "-flaky"    → TransientException 50% of the time (for retry tests)
 *   anything else               → success, returns "AUTH-" + UUID
 *
 * In profiles {@code prod} or {@code staging}, this bean is NOT loaded; a real
 * adapter (e.g. StripePaymentGateway) is provided instead.
 */
@Component
@Profile("!prod & !staging")
public class MockPaymentGateway implements PaymentGateway {

    private final SecureRandom random = new SecureRandom();

    @Override
    public String authorize(String paymentMethodToken, BigDecimal amount, String currency) {
        if (paymentMethodToken.endsWith("-decline")) {
            throw new DeclinedException("insufficient_funds");
        }
        if (paymentMethodToken.endsWith("-flaky") && random.nextBoolean()) {
            throw new TransientException("simulated network blip", null);
        }
        return "AUTH-" + UUID.randomUUID();
    }

    @Override
    public void capture(String authCode) {
        // Mock: capture always succeeds.
    }
}