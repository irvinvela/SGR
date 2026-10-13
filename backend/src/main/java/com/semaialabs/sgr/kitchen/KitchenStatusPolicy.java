package com.semaialabs.sgr.kitchen;

import java.util.Map;

public final class KitchenStatusPolicy {
    private static final Map<String, String> NEXT_STATUS = Map.of(
            "QUEUED", "PREPARING",
            "PREPARING", "READY",
            "READY", "COMPLETED"
    );

    private KitchenStatusPolicy() {
    }

    public static boolean allows(String currentStatus, String requestedStatus) {
        return requestedStatus != null && requestedStatus.equals(NEXT_STATUS.get(currentStatus));
    }
}
