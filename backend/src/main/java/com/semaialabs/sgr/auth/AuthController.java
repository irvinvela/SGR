package com.semaialabs.sgr.auth;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.semaialabs.sgr.config.SecretObfuscator;
import com.semaialabs.sgr.config.SecurityProperties;
import com.semaialabs.sgr.staff.StaffPolicy;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthenticationManager authenticationManager;
    private final JwtEncoder jwtEncoder;
    private final SecurityProperties securityProperties;
    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;

    public AuthController(
            AuthenticationManager authenticationManager,
            JwtEncoder jwtEncoder,
            SecurityProperties securityProperties,
            JdbcClient jdbc,
            PasswordEncoder passwordEncoder
    ) {
        this.authenticationManager = authenticationManager;
        this.jwtEncoder = jwtEncoder;
        this.securityProperties = securityProperties;
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("token", token.getToken());
    }

    @PostMapping({"/login", "/session"})
    public ResponseEntity<UserResponse> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest
    ) {
        String normalizedEmail = request.email().trim().toLowerCase(java.util.Locale.ROOT);
        String resolvedCredential = SecretObfuscator.decodeCredential(request.credential());
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            normalizedEmail,
                            resolvedCredential
                    )
            );
        } catch (AuthenticationException error) {
            recordFailedLogin(normalizedEmail);
            throw error;
        }
        SgrUser user = (SgrUser) authentication.getPrincipal();
        Instant now = Instant.now();
        Instant expiresAt = now.plus(securityProperties.accessTokenDuration(request.remember()));

        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(securityProperties.issuer())
                .issuedAt(now)
                .expiresAt(expiresAt)
                .subject(user.id().toString())
                .id(UUID.randomUUID().toString())
                .claim("email", user.email())
                .claim("name", user.displayName())
                .claim("organization_id", user.organizationId().toString())
                .claim("organization_name", user.organizationName())
                .claim("role", user.role())
                .claim("token_version", user.tokenVersion())
                .claim("scope", "sgr")
                .build();
        JwsHeader jwsHeader = JwsHeader.with(MacAlgorithm.HS256).build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(jwsHeader, claims)).getTokenValue();

        jdbc.sql("UPDATE app_users SET last_login_at = SYSUTCDATETIME(), failed_login_attempts = 0 WHERE id = :id")
                .param("id", user.id())
                .update();
        writeAudit(user, "AUTH_LOGIN", httpRequest);

        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, accessCookie(token, request.remember()).toString())
                .body(UserResponse.from(user));
    }

    private void recordFailedLogin(String normalizedEmail) {
        jdbc.sql("""
                UPDATE app_users
                SET failed_login_attempts = failed_login_attempts + 1,
                    locked_until = CASE
                        WHEN failed_login_attempts + 1 >= 5
                        THEN DATEADD(MINUTE, 15, SYSUTCDATETIME())
                        ELSE locked_until
                    END,
                    updated_at = SYSUTCDATETIME()
                WHERE normalized_email = :email
                """)
                .param("email", normalizedEmail)
                .update();
    }

    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal Jwt jwt) {
        return new UserResponse(
                UUID.fromString(jwt.getSubject()),
                jwt.getClaimAsString("email"),
                jwt.getClaimAsString("name"),
                UUID.fromString(jwt.getClaimAsString("organization_id")),
                jwt.getClaimAsString("organization_name"),
                jwt.getClaimAsString("role")
        );
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout() {
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, expiredAccessCookie().toString())
                .build();
    }

    @PostMapping({"/change-password", "/credentials"})
    public ResponseEntity<Void> changePassword(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangePasswordRequest request,
            HttpServletRequest httpRequest
    ) {
        String currentSecret = SecretObfuscator.decodeCredential(request.currentCredential());
        String nextSecret = SecretObfuscator.decodeCredential(request.nextCredential());
        authenticationManager.authenticate(
                UsernamePasswordAuthenticationToken.unauthenticated(
                        jwt.getClaimAsString("email"),
                        currentSecret
                )
        );
        try {
            StaffPolicy.validatePassword(nextSecret);
        } catch (IllegalArgumentException error) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    error.getMessage(),
                    error
            );
        }
        if (currentSecret.equals(nextSecret)) {
            throw new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.BAD_REQUEST,
                    "La nueva contraseña debe ser diferente"
            );
        }

        jdbc.sql("""
                UPDATE app_users
                SET password_hash = :passwordHash,
                    token_version = token_version + 1,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :userId
                """)
                .param("passwordHash", passwordEncoder.encode(nextSecret))
                .param("userId", TenantContext.userId(jwt))
                .update();
        jdbc.sql("""
                INSERT INTO audit_events (
                    organization_id, actor_user_id, event_type, ip_address, user_agent
                ) VALUES (
                    :organizationId, :userId, 'AUTH_PASSWORD_CHANGED', :ipAddress, :userAgent
                )
                """)
                .param("organizationId", TenantContext.organizationId(jwt))
                .param("userId", TenantContext.userId(jwt))
                .param("ipAddress", httpRequest.getRemoteAddr())
                .param("userAgent", httpRequest.getHeader("User-Agent"))
                .update();
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, expiredAccessCookie().toString())
                .build();
    }

    private ResponseCookie accessCookie(String token, boolean remember) {
        ResponseCookie.ResponseCookieBuilder builder = ResponseCookie
                .from(CookieBearerTokenResolver.COOKIE_NAME, token)
                .httpOnly(true)
                .secure(securityProperties.secureCookie())
                .sameSite("Strict")
                .path("/");
        if (remember) {
            builder.maxAge(securityProperties.accessTokenDuration(true));
        }
        return builder.build();
    }

    private ResponseCookie expiredAccessCookie() {
        return CookieBearerTokenResolver.clearAccessCookie(securityProperties.secureCookie());
    }

    private void writeAudit(SgrUser user, String event, HttpServletRequest request) {
        jdbc.sql("""
                INSERT INTO audit_events (
                    organization_id, actor_user_id, event_type, ip_address, user_agent
                ) VALUES (
                    :organizationId, :userId, :eventType, :ipAddress, :userAgent
                )
                """)
                .param("organizationId", user.organizationId())
                .param("userId", user.id())
                .param("eventType", event)
                .param("ipAddress", request.getRemoteAddr())
                .param("userAgent", request.getHeader("User-Agent"))
                .update();
    }

    public record LoginRequest(
            @NotBlank @Email String email,
            @NotBlank @JsonAlias({"password", "k"}) String credential,
            boolean remember
    ) {
        @Override
        public String toString() {
            return "LoginRequest[email=" + email + ", credential=[PROTECTED], remember=" + remember + "]";
        }
    }

    public record ChangePasswordRequest(
            @NotBlank @JsonAlias({"currentPassword", "c"}) String currentCredential,
            @NotBlank @Size(max = 512) @JsonAlias({"newPassword", "n"}) String nextCredential
    ) {
        @Override
        public String toString() {
            return "ChangePasswordRequest[currentCredential=[PROTECTED], nextCredential=[PROTECTED]]";
        }
    }

    public record UserResponse(
            UUID id,
            String email,
            String displayName,
            UUID organizationId,
            String organizationName,
            String role
    ) {
        static UserResponse from(SgrUser user) {
            return new UserResponse(
                    user.id(),
                    user.email(),
                    user.displayName(),
                    user.organizationId(),
                    user.organizationName(),
                    user.role()
            );
        }
    }
}
