package com.semaialabs.sgr.sales;

import java.math.BigDecimal;
import java.math.RoundingMode;

public final class TaxInclusivePolicy {
    private static final BigDecimal ONE_HUNDRED = new BigDecimal("100");
    private static final int MONEY_SCALE = 4;

    private TaxInclusivePolicy() {
    }

    public static TaxAmounts fromGross(BigDecimal grossAmount, BigDecimal taxRate) {
        if (grossAmount == null || grossAmount.signum() < 0) {
            throw new IllegalArgumentException("El importe bruto no puede ser negativo");
        }
        if (taxRate == null || taxRate.signum() < 0 || taxRate.compareTo(ONE_HUNDRED) > 0) {
            throw new IllegalArgumentException("El tipo de IVA no es válido");
        }
        BigDecimal normalizedGross = grossAmount.setScale(MONEY_SCALE, RoundingMode.HALF_UP);
        BigDecimal divisor = BigDecimal.ONE.add(taxRate.divide(ONE_HUNDRED));
        BigDecimal taxableBase = normalizedGross.divide(divisor, MONEY_SCALE, RoundingMode.HALF_UP);
        return new TaxAmounts(
                normalizedGross,
                taxableBase,
                normalizedGross.subtract(taxableBase)
        );
    }

    public record TaxAmounts(
            BigDecimal grossAmount,
            BigDecimal taxableBase,
            BigDecimal taxAmount
    ) {
    }
}
