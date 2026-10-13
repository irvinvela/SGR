package com.semaialabs.sgr.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;

class SecurityConfigTest {
    @Test
    void mapsRoleClaimToSpringRoleAuthority() {
        UUID userId = UUID.randomUUID();
        UUID organizationId = UUID.randomUUID();
        Jwt jwt = Jwt.withTokenValue("token")
                .header("alg", "HS256")
                .subject(userId.toString())
                .claim("organization_id", organizationId.toString())
                .claim("role", "OWNER")
                .issuedAt(Instant.now())
                .expiresAt(Instant.now().plusSeconds(300))
                .build();

        JwtAuthenticationToken authentication = (JwtAuthenticationToken)
                new SecurityConfig().jwtAuthenticationConverter().convert(jwt);

        assertThat(authentication.getAuthorities())
                .extracting("authority")
                .containsExactly("ROLE_OWNER");
    }
}
