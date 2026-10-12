package com.semaialabs.sgr.tenant;

import java.util.UUID;
import org.springframework.security.oauth2.jwt.Jwt;

public final class TenantContext {
    private TenantContext() {
    }

    public static UUID organizationId(Jwt jwt) {
        return UUID.fromString(jwt.getClaimAsString("organization_id"));
    }

    public static UUID userId(Jwt jwt) {
        return UUID.fromString(jwt.getSubject());
    }
}
