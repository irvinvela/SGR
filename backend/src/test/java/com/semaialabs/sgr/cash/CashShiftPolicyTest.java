package com.semaialabs.sgr.cash;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class CashShiftPolicyTest {
    @Test
    void reconcilesOpeningSalesAndMovements() {
        CashShiftPolicy.Reconciliation result = CashShiftPolicy.reconcile(
                new BigDecimal("100.00"),
                new BigDecimal("250.00"),
                new BigDecimal("20.00"),
                new BigDecimal("30.00"),
                new BigDecimal("338.50")
        );

        assertThat(result.expectedCash()).isEqualByComparingTo("340.00");
        assertThat(result.difference()).isEqualByComparingTo("-1.50");
    }

    @Test
    void rejectsNegativeCount() {
        assertThatThrownBy(() -> CashShiftPolicy.reconcile(
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                new BigDecimal("-0.01")
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("El efectivo contado no puede ser negativo");
    }

    @Test
    void rejectsPaidOutAboveExpectedCash() {
        assertThatThrownBy(() -> CashShiftPolicy.reconcile(
                new BigDecimal("10.00"),
                BigDecimal.ZERO,
                BigDecimal.ZERO,
                new BigDecimal("10.01"),
                BigDecimal.ZERO
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Las salidas superan el efectivo esperado");
    }
}
