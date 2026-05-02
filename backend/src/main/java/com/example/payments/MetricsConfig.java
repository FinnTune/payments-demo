package com.example.payments;

import io.micrometer.core.aop.TimedAspect;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires up Micrometer's @Timed annotation processor.
 *
 * Without this bean, @Timed annotations on methods are silently no-ops.
 * Spring Boot auto-configures @Transactional and @Retryable aspects but
 * not @Timed — Micrometer is a separate project, and its aspects must
 * be registered explicitly.
 */
@Configuration
public class MetricsConfig {

    @Bean
    public TimedAspect timedAspect(MeterRegistry registry) {
        return new TimedAspect(registry);
    }
}