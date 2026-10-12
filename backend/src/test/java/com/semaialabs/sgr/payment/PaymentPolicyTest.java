package com.semaialabs.sgr.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class PaymentPolicyTest {
    @Test
    void calculatesCashChangeWithoutCountingItAsPayment() {
        PaymentPolicy.PaymentAmounts result = PaymentPolicy.validate(
                new BigDecimal("25.00"),
                "CASH",
                new BigDecimal("20.00"),
                new BigDecimal("50.00")
        );

        assertThat(result.amount()).isEqualByComparingTo("20.00");
        assertThat(result.changeAmount()).isEqualByComparingTo("30.00");
    }

    @Test
    void acceptsPartialCardPayment() {
        PaymentPolicy.PaymentAmounts result = PaymentPolicy.validate(
                new BigDecimal("25.00"),
                "CARD",
                new BigDecimal("10.00"),
                null
        );

        assertThat(result.amount()).isEqualByComparingTo("10.00");
        assertThat(result.changeAmount()).isZero();
        assertThat(result.remainingAfter()).isEqualByComparingTo("15.00");
        assertThat(result.closesOrder()).isFalse();
    }

    @Test
    void marksExactSettlementForOrderClose() {
        PaymentPolicy.PaymentAmounts result = PaymentPolicy.validate(
                new BigDecimal("25.00"),
                "CARD",
                new BigDecimal("25.00"),
                null
        );

        assertThat(result.remainingAfter()).isZero();
        assertThat(result.closesOrder()).isTrue();
    }

    @Test
    void rejectsOverpayment() {
        assertThatThrownBy(() -> PaymentPolicy.validate(
                new BigDecimal("25.00"),
                "CARD",
                new BigDecimal("25.01"),
                null
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("El importe supera el saldo pendiente");
    }

    @Test
    void rejectsNonPositivePayment() {
        assertThatThrownBy(() -> PaymentPolicy.validate(
                new BigDecimal("25.00"),
                "CASH",
                BigDecimal.ZERO,
                BigDecimal.ZERO
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("El importe debe ser mayor que cero");
    }
}
