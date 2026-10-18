package com.semaialabs.sgr.kitchen;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class KitchenStatusPolicyTest {
    @Test
    void permitsOnlyForwardSingleStepTransitions() {
        assertThat(KitchenStatusPolicy.allows("QUEUED", "PREPARING")).isTrue();
        assertThat(KitchenStatusPolicy.allows("PREPARING", "READY")).isTrue();
        assertThat(KitchenStatusPolicy.allows("READY", "COMPLETED")).isTrue();

        assertThat(KitchenStatusPolicy.allows("QUEUED", "READY")).isFalse();
        assertThat(KitchenStatusPolicy.allows("READY", "PREPARING")).isFalse();
        assertThat(KitchenStatusPolicy.allows("COMPLETED", "QUEUED")).isFalse();
        assertThat(KitchenStatusPolicy.allows("QUEUED", null)).isFalse();
    }
}
