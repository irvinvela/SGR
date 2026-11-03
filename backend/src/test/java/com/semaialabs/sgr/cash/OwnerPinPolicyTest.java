package com.semaialabs.sgr.cash;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class OwnerPinPolicyTest {
    @Test
    void acceptsFourToSixDigits() {
        assertThatCode(() -> OwnerPinPolicy.validateFormat("1234")).doesNotThrowAnyException();
        assertThatCode(() -> OwnerPinPolicy.validateFormat("123456")).doesNotThrowAnyException();
    }

    @Test
    void rejectsShortOrAlpha() {
        assertThatThrownBy(() -> OwnerPinPolicy.validateFormat("123"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> OwnerPinPolicy.validateFormat("12ab"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
