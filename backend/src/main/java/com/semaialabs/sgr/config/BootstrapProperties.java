package com.semaialabs.sgr.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "sgr.bootstrap")
public record BootstrapProperties(
        String ownerEmail,
        String ownerPassword,
        String ownerName,
        String organizationName
) {
    public boolean isConfigured() {
        return hasText(ownerEmail)
                && hasText(ownerPassword)
                && hasText(ownerName)
                && hasText(organizationName);
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
