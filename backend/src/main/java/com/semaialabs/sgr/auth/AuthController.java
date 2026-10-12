package com.semaialabs.sgr.auth;

import com.semaialabs.sgr.config.SecurityProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
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

    public AuthController(
            AuthenticationManager authenticationManager,
            JwtEncoder jwtEncoder,
            SecurityProperties securityProperties,
            JdbcClient jdbc
    ) {
        this.authenticationManager = authenticationManager;
        this.jwtEncoder = jwtEncoder;
        this.securityProperties = securityProperties;
        this.jdbc = jdbc;
    }

    @GetMapping("/csrf")
    public Map<String, String> csrf(CsrfToken token) {
        return Map.of("token", token.getToken());
    }

    @PostMapping("/login")
    public ResponseEntity<UserResponse> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest httpRequest
    ) {
        String normalizedEmail = request.email().trim().toLowerCase(java.util.Locale.ROOT);
        Authentication authentication;
        try {
            authentication = authenticationManager.authenticate(
                    UsernamePasswordAuthenticationToken.unauthenticated(
                            normalizedEmail,
                            request.password()
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
                .claim("scope", "sgr")
                .build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(claims)).getTokenValue();

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
        ResponseCookie expired = ResponseCookie.from(CookieBearerTokenResolver.COOKIE_NAME, "")
                .httpOnly(true)
                .secure(securityProperties.secureCookie())
                .sameSite("Strict")
                .path("/")
                .maxAge(0)
                .build();
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, expired.toString())
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
            @NotBlank String password,
            boolean remember
    ) {
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
