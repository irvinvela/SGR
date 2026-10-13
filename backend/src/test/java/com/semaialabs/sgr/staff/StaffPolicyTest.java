package com.semaialabs.sgr.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class StaffPolicyTest {
    @Test
    void ownerCanAssignOperationalAndManagementRoles() {
        assertThat(StaffPolicy.canAssignRole("OWNER", "OWNER")).isTrue();
        assertThat(StaffPolicy.canAssignRole("OWNER", "MANAGER")).isTrue();
        assertThat(StaffPolicy.canAssignRole("OWNER", "SERVER")).isTrue();
    }

    @Test
    void managerCanOnlyAssignOperationalRoles() {
        assertThat(StaffPolicy.canAssignRole("MANAGER", "CASHIER")).isTrue();
        assertThat(StaffPolicy.canAssignRole("MANAGER", "MANAGER")).isFalse();
        assertThat(StaffPolicy.canManage("MANAGER", "OWNER")).isFalse();
    }

    @Test
    void platformAdministratorCannotBeAssigned() {
        assertThat(StaffPolicy.canAssignRole("OWNER", "PLATFORM_ADMIN")).isFalse();
    }

    @Test
    void acceptsStrongPassword() {
        StaffPolicy.validatePassword("Segura2026Clave");
    }

    @Test
    void rejectsShortOrSimplePassword() {
        assertThatThrownBy(() -> StaffPolicy.validatePassword("corta1A"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("La contraseña debe tener al menos 12 caracteres");
        assertThatThrownBy(() -> StaffPolicy.validatePassword("sololetrasminusculas"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("La contraseña debe incluir mayúsculas, minúsculas y números");
    }
}
