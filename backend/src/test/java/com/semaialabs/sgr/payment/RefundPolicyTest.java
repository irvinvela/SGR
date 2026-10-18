package com.semaialabs.sgr.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class RefundPolicyTest {
    @Test
    void acceptsPartialRefundWithinAvailableAmount() {
        RefundPolicy.RefundAmounts result = RefundPolicy.validate(
                new BigDecimal("25.00"),
                new BigDecimal("5.00"),
                new BigDecimal("10.00")
        );

        assertThat(result.refundableAfter()).isEqualByComparingTo("10.00");
        assertThat(result.fullyRefundsPayment()).isFalse();
    }

    @Test
    void recognizesFullRefund() {
        RefundPolicy.RefundAmounts result = RefundPolicy.validate(
                new BigDecimal("25.00"),
                BigDecimal.ZERO,
                new BigDecimal("25.00")
        );

        assertThat(result.refundableAfter()).isZero();
        assertThat(result.fullyRefundsPayment()).isTrue();
    }

    @Test
    void rejectsAmountAboveAvailablePayment() {
        assertThatThrownBy(() -> RefundPolicy.validate(
                new BigDecimal("25.00"),
                new BigDecimal("10.00"),
                new BigDecimal("15.01")
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("El reembolso supera el importe disponible");
    }
}
