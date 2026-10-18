package com.semaialabs.sgr.sales;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class TaxInclusivePolicyTest {
    @Test
    void extractsTenPercentTaxFromGrossPrice() {
        TaxInclusivePolicy.TaxAmounts result = TaxInclusivePolicy.fromGross(
                new BigDecimal("22.00"),
                new BigDecimal("10.00")
        );

        assertThat(result.taxableBase()).isEqualByComparingTo("20.0000");
        assertThat(result.taxAmount()).isEqualByComparingTo("2.0000");
    }

    @Test
    void preservesZeroRatedGrossAsTaxableBase() {
        TaxInclusivePolicy.TaxAmounts result = TaxInclusivePolicy.fromGross(
                new BigDecimal("15.50"),
                BigDecimal.ZERO
        );

        assertThat(result.taxableBase()).isEqualByComparingTo("15.5000");
        assertThat(result.taxAmount()).isZero();
    }

    @Test
    void rejectsInvalidTaxRate() {
        assertThatThrownBy(() -> TaxInclusivePolicy.fromGross(
                BigDecimal.ONE,
                new BigDecimal("100.01")
        )).isInstanceOf(IllegalArgumentException.class)
                .hasMessage("El tipo de IVA no es válido");
    }
}
