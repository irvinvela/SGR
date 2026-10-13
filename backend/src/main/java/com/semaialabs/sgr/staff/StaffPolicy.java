package com.semaialabs.sgr.staff;

import java.util.Set;

public final class StaffPolicy {
    private static final Set<String> ASSIGNABLE_ROLES = Set.of(
            "OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN"
    );
    private static final Set<String> MANAGER_ASSIGNABLE_ROLES = Set.of(
            "CASHIER", "SERVER", "KITCHEN"
    );

    private StaffPolicy() {
    }

    public static boolean canAssignRole(String actorRole, String role) {
        if (!ASSIGNABLE_ROLES.contains(role)) {
            return false;
        }
        if ("OWNER".equals(actorRole)) {
            return true;
        }
        return "MANAGER".equals(actorRole) && MANAGER_ASSIGNABLE_ROLES.contains(role);
    }

    public static boolean canManage(String actorRole, String targetRole) {
        if ("OWNER".equals(actorRole)) {
            return !"PLATFORM_ADMIN".equals(targetRole);
        }
        return "MANAGER".equals(actorRole) && MANAGER_ASSIGNABLE_ROLES.contains(targetRole);
    }

    public static void validatePassword(String password) {
        if (password == null || password.length() < 12) {
            throw new IllegalArgumentException("La contraseña debe tener al menos 12 caracteres");
        }
        boolean upper = password.chars().anyMatch(Character::isUpperCase);
        boolean lower = password.chars().anyMatch(Character::isLowerCase);
        boolean digit = password.chars().anyMatch(Character::isDigit);
        if (!upper || !lower || !digit) {
            throw new IllegalArgumentException(
                    "La contraseña debe incluir mayúsculas, minúsculas y números"
            );
        }
    }
}
