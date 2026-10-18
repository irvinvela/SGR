package com.semaialabs.sgr.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
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

    @Test
    void encodesAndDecodesHs256JwtWithConfiguredSecretKey() {
        SecurityConfig config = new SecurityConfig();
        SecurityProperties properties = new SecurityProperties(
                "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
                "https://semaialabs.com",
                480,
                7,
                true
        );
        var secretKey = config.jwtSecretKey(properties);
        JwtEncoder encoder = config.jwtEncoder(secretKey);
        JwtDecoder decoder = org.springframework.security.oauth2.jwt.NimbusJwtDecoder
                .withSecretKey(secretKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();

        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(properties.issuer())
                .issuedAt(now)
                .expiresAt(now.plusSeconds(300))
                .subject(UUID.randomUUID().toString())
                .claim("role", "OWNER")
                .build();

        String tokenValue = encoder.encode(
                JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)
        ).getTokenValue();
        Jwt decoded = decoder.decode(tokenValue);

        assertThat(decoded.getClaimAsString("role")).isEqualTo("OWNER");
    }
}
