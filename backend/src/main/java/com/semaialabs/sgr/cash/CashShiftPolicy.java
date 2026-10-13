package com.semaialabs.sgr.cash;

import java.math.BigDecimal;

public final class CashShiftPolicy {
    private CashShiftPolicy() {
    }

    public static Reconciliation reconcile(
            BigDecimal openingAmount,
            BigDecimal cashSales,
            BigDecimal cashRefunds,
            BigDecimal paidIn,
            BigDecimal paidOut,
            BigDecimal countedCash
    ) {
        requireNonNegative(openingAmount, "El fondo inicial no puede ser negativo");
        requireNonNegative(cashSales, "Las ventas en efectivo no pueden ser negativas");
        requireNonNegative(cashRefunds, "Los reembolsos en efectivo no pueden ser negativos");
        requireNonNegative(paidIn, "Las entradas no pueden ser negativas");
        requireNonNegative(paidOut, "Las salidas no pueden ser negativas");
        requireNonNegative(countedCash, "El efectivo contado no puede ser negativo");

        BigDecimal expected = openingAmount
                .add(cashSales)
                .subtract(cashRefunds)
                .add(paidIn)
                .subtract(paidOut);
        if (expected.signum() < 0) {
            throw new IllegalArgumentException("Las salidas superan el efectivo esperado");
        }
        return new Reconciliation(expected, countedCash.subtract(expected));
    }

    private static void requireNonNegative(BigDecimal value, String message) {
        if (value == null || value.signum() < 0) {
            throw new IllegalArgumentException(message);
        }
    }

    public record Reconciliation(BigDecimal expectedCash, BigDecimal difference) {
    }
}
