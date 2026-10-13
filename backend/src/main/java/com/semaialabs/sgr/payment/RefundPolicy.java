package com.semaialabs.sgr.payment;

import java.math.BigDecimal;

public final class RefundPolicy {
    private RefundPolicy() {
    }

    public static RefundAmounts validate(
            BigDecimal paymentAmount,
            BigDecimal alreadyRefunded,
            BigDecimal requestedAmount
    ) {
        if (paymentAmount == null || paymentAmount.signum() <= 0) {
            throw new IllegalArgumentException("El pago no tiene importe reembolsable");
        }
        if (alreadyRefunded == null || alreadyRefunded.signum() < 0) {
            throw new IllegalArgumentException("El importe ya reembolsado no es válido");
        }
        if (requestedAmount == null || requestedAmount.signum() <= 0) {
            throw new IllegalArgumentException("El reembolso debe ser mayor que cero");
        }
        BigDecimal available = paymentAmount.subtract(alreadyRefunded);
        if (available.signum() <= 0) {
            throw new IllegalArgumentException("El pago ya fue reembolsado completamente");
        }
        if (requestedAmount.compareTo(available) > 0) {
            throw new IllegalArgumentException("El reembolso supera el importe disponible");
        }
        return new RefundAmounts(requestedAmount, available.subtract(requestedAmount));
    }

    public record RefundAmounts(BigDecimal amount, BigDecimal refundableAfter) {
        public boolean fullyRefundsPayment() {
            return refundableAfter.signum() == 0;
        }
    }
}
