package com.semaialabs.sgr.payment;

import java.math.BigDecimal;

public final class PaymentPolicy {
    private PaymentPolicy() {
    }

    public static PaymentAmounts validate(
            BigDecimal remaining,
            String method,
            BigDecimal amount,
            BigDecimal tenderedAmount
    ) {
        if (remaining == null || remaining.signum() <= 0) {
            throw new IllegalArgumentException("El pedido no tiene saldo pendiente");
        }
        if (amount == null || amount.signum() <= 0) {
            throw new IllegalArgumentException("El importe debe ser mayor que cero");
        }
        if (amount.compareTo(remaining) > 0) {
            throw new IllegalArgumentException("El importe supera el saldo pendiente");
        }

        if ("CASH".equals(method)) {
            if (tenderedAmount == null || tenderedAmount.compareTo(amount) < 0) {
                throw new IllegalArgumentException("El efectivo recibido no cubre el importe");
            }
            return new PaymentAmounts(
                    amount,
                    tenderedAmount,
                    tenderedAmount.subtract(amount),
                    remaining.subtract(amount)
            );
        }
        if ("CARD".equals(method)) {
            if (tenderedAmount != null) {
                throw new IllegalArgumentException("El pago con tarjeta no admite efectivo recibido");
            }
            return new PaymentAmounts(amount, null, BigDecimal.ZERO, remaining.subtract(amount));
        }
        throw new IllegalArgumentException("Método de pago no permitido");
    }

    public record PaymentAmounts(
            BigDecimal amount,
            BigDecimal tenderedAmount,
            BigDecimal changeAmount,
            BigDecimal remainingAfter
    ) {
        public boolean closesOrder() {
            return remainingAfter.signum() == 0;
        }
    }
}
