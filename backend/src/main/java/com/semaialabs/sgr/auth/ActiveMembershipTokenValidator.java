package com.semaialabs.sgr.auth;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

@Component
public class ActiveMembershipTokenValidator implements OAuth2TokenValidator<Jwt> {
    private static final OAuth2Error INVALID_MEMBERSHIP = new OAuth2Error(
            "invalid_token",
            "La sesión ya no está activa",
            null
    );

    private final JdbcClient jdbc;

    public ActiveMembershipTokenValidator(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        try {
            UUID userId = UUID.fromString(token.getSubject());
            UUID organizationId = UUID.fromString(token.getClaimAsString("organization_id"));
            String role = token.getClaimAsString("role");
            Number tokenVersion = token.getClaim("token_version");
            if (role == null || tokenVersion == null) {
                return OAuth2TokenValidatorResult.failure(INVALID_MEMBERSHIP);
            }
            boolean valid = jdbc.sql("""
                    SELECT CASE WHEN EXISTS (
                        SELECT 1
                        FROM app_users u
                        INNER JOIN user_organizations uo
                            ON uo.user_id = u.id
                           AND uo.organization_id = :organizationId
                        INNER JOIN organizations o
                            ON o.id = uo.organization_id
                        WHERE u.id = :userId
                          AND u.active = 1
                          AND uo.active = 1
                          AND o.active = 1
                          AND uo.role = :role
                          AND u.token_version = :tokenVersion
                    ) THEN 1 ELSE 0 END
                    """)
                    .param("organizationId", organizationId)
                    .param("userId", userId)
                    .param("role", role)
                    .param("tokenVersion", tokenVersion.longValue())
                    .query(Boolean.class)
                    .single();
            return valid
                    ? OAuth2TokenValidatorResult.success()
                    : OAuth2TokenValidatorResult.failure(INVALID_MEMBERSHIP);
        } catch (IllegalArgumentException | NullPointerException error) {
            return OAuth2TokenValidatorResult.failure(INVALID_MEMBERSHIP);
        }
    }
}
