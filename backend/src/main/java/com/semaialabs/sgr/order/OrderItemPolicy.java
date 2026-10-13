package com.semaialabs.sgr.order;

import java.util.Set;

public final class OrderItemPolicy {
    private static final Set<String> MANAGER_ROLES = Set.of("OWNER", "MANAGER");

    private OrderItemPolicy() {
    }

    public static boolean canEdit(String orderStatus, boolean sentToKitchen) {
        return "OPEN".equals(orderStatus) && !sentToKitchen;
    }

    public static boolean canVoid(String orderStatus, boolean sentToKitchen, String role) {
        if (!"OPEN".equals(orderStatus)) {
            return false;
        }
        return !sentToKitchen || MANAGER_ROLES.contains(role);
    }
}
