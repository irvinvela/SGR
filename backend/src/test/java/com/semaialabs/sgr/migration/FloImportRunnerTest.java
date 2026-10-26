package com.semaialabs.sgr.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.Test;

class FloImportRunnerTest {
    @Test
    void createsStableCodesWithoutAccentsOrDuplicates() {
        Set<String> used = new HashSet<>();

        assertThat(FloImportRunner.uniqueCode("Café", used)).isEqualTo("CAFE");
        assertThat(FloImportRunner.uniqueCode("Cafe", used)).isEqualTo("CAFE-2");
        assertThat(FloImportRunner.uniqueCode("Especialidades peruanas", used))
                .isEqualTo("ESPECIALIDADES-PERUANAS");
    }

    @Test
    void createsDeterministicIdsScopedByEntityType() {
        var first = FloImportRunner.stableUuid("1305", "product", "source-1");
        var repeated = FloImportRunner.stableUuid("1305", "product", "source-1");
        var otherType = FloImportRunner.stableUuid("1305", "user", "source-1");

        assertThat(first).isEqualTo(repeated);
        assertThat(first).isNotEqualTo(otherType);
    }
}
