package com.semaialabs.sgr.staff;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.config.SecretObfuscator;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/staff")
@PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
public class StaffController {
    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final AuditService audit;

    public StaffController(JdbcClient jdbc, PasswordEncoder passwordEncoder, AuditService audit) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.audit = audit;
    }

    @GetMapping
    public List<StaffResponse> list(@AuthenticationPrincipal Jwt jwt) {
        UUID organizationId = TenantContext.organizationId(jwt);
        String actorRole = jwt.getClaimAsString("role");
        return jdbc.sql("""
                SELECT u.id, u.email, u.display_name, u.last_login_at,
                       uo.role, uo.active
                FROM user_organizations uo
                INNER JOIN app_users u ON u.id = uo.user_id
                WHERE uo.organization_id = :organizationId
                ORDER BY
                    CASE uo.role
                        WHEN 'OWNER' THEN 0
                        WHEN 'MANAGER' THEN 1
                        WHEN 'CASHIER' THEN 2
                        WHEN 'SERVER' THEN 3
                        WHEN 'KITCHEN' THEN 4
                        ELSE 5
                    END,
                    u.display_name
                """)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new StaffResponse(
                        rs.getObject("id", UUID.class),
                        rs.getString("email"),
                        rs.getString("display_name"),
                        rs.getString("role"),
                        rs.getBoolean("active"),
                        rs.getTimestamp("last_login_at") == null
                                ? null
                                : rs.getTimestamp("last_login_at").toInstant().toString()
                ))
                .list()
                .stream()
                .filter(member -> StaffPolicy.canView(actorRole, member.role()))
                .toList();
    }

    @PostMapping
    @Transactional
    public StaffResponse create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateStaffRequest request
    ) {
        requireAssignable(jwt, request.role());
        String rawCredential = SecretObfuscator.decodeCredential(request.credential());
        validatePassword(rawCredential);
        UUID organizationId = TenantContext.organizationId(jwt);
        String email = request.email().trim();
        String normalizedEmail = email.toLowerCase(Locale.ROOT);
        boolean exists = jdbc.sql("""
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM app_users WHERE normalized_email = :email
                ) THEN 1 ELSE 0 END
                """)
                .param("email", normalizedEmail)
                .query(Boolean.class)
                .single();
        if (exists) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Ya existe un usuario con ese correo"
            );
        }

        UUID userId = UUID.randomUUID();
        try {
            jdbc.sql("""
                    INSERT INTO app_users (
                        id, email, normalized_email, password_hash, display_name
                    ) VALUES (
                        :id, :email, :normalizedEmail, :passwordHash, :displayName
                    )
                    """)
                    .param("id", userId)
                    .param("email", email)
                    .param("normalizedEmail", normalizedEmail)
                    .param("passwordHash", passwordEncoder.encode(rawCredential))
                    .param("displayName", request.displayName().trim())
                    .update();
        } catch (DuplicateKeyException error) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Ya existe un usuario con ese correo",
                    error
            );
        }
        jdbc.sql("""
                INSERT INTO user_organizations (user_id, organization_id, role)
                VALUES (:userId, :organizationId, :role)
                """)
                .param("userId", userId)
                .param("organizationId", organizationId)
                .param("role", request.role())
                .update();
        audit.record(
                jwt,
                "STAFF_CREATED",
                "app_user",
                userId,
                Map.of("role", request.role(), "email", normalizedEmail)
        );
        return findStaff(organizationId, userId);
    }

    @PatchMapping("/role")
    @Transactional
    public StaffResponse changeRole(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangeRoleRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        StaffLock target = lockStaff(organizationId, request.userId());
        requireCanManage(jwt, target.role());
        requireAssignable(jwt, request.role());
        if (TenantContext.userId(jwt).equals(request.userId())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "No puede cambiar su propio rol");
        }
        if ("OWNER".equals(target.role()) && !"OWNER".equals(request.role())) {
            requireAnotherOwner(organizationId, request.userId());
        }
        jdbc.sql("""
                UPDATE user_organizations
                SET role = :role
                WHERE user_id = :userId AND organization_id = :organizationId
                """)
                .param("role", request.role())
                .param("userId", request.userId())
                .param("organizationId", organizationId)
                .update();
        invalidateSessions(request.userId());
        audit.record(
                jwt,
                "STAFF_ROLE_CHANGED",
                "app_user",
                request.userId(),
                Map.of("from", target.role(), "to", request.role())
        );
        return findStaff(organizationId, request.userId());
    }

    @PatchMapping("/status")
    @Transactional
    public StaffResponse changeStatus(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangeStatusRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        StaffLock target = lockStaff(organizationId, request.userId());
        requireCanManage(jwt, target.role());
        if (TenantContext.userId(jwt).equals(request.userId()) && !request.active()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "No puede desactivar su propia cuenta"
            );
        }
        if ("OWNER".equals(target.role()) && !request.active()) {
            requireAnotherOwner(organizationId, request.userId());
        }
        jdbc.sql("""
                UPDATE user_organizations
                SET active = :active
                WHERE user_id = :userId AND organization_id = :organizationId
                """)
                .param("active", request.active())
                .param("userId", request.userId())
                .param("organizationId", organizationId)
                .update();
        invalidateSessions(request.userId());
        audit.record(
                jwt,
                request.active() ? "STAFF_ACTIVATED" : "STAFF_DEACTIVATED",
                "app_user",
                request.userId(),
                Map.of()
        );
        return findStaff(organizationId, request.userId());
    }

    @PostMapping({"/reset-password", "/credentials"})
    @Transactional
    public StaffResponse resetPassword(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ResetPasswordRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        StaffLock target = lockStaff(organizationId, request.userId());
        requireCanManage(jwt, target.role());
        String rawCredential = SecretObfuscator.decodeCredential(request.credential());
        validatePassword(rawCredential);
        jdbc.sql("""
                UPDATE app_users
                SET password_hash = :passwordHash,
                    token_version = token_version + 1,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :userId
                """)
                .param("passwordHash", passwordEncoder.encode(rawCredential))
                .param("userId", request.userId())
                .update();
        audit.record(jwt, "STAFF_PASSWORD_RESET", "app_user", request.userId(), Map.of());
        return findStaff(organizationId, request.userId());
    }

    private StaffResponse findStaff(UUID organizationId, UUID userId) {
        return jdbc.sql("""
                SELECT u.id, u.email, u.display_name, u.last_login_at,
                       uo.role, uo.active
                FROM user_organizations uo
                INNER JOIN app_users u ON u.id = uo.user_id
                WHERE uo.organization_id = :organizationId AND u.id = :userId
                """)
                .param("organizationId", organizationId)
                .param("userId", userId)
                .query((rs, rowNum) -> new StaffResponse(
                        rs.getObject("id", UUID.class),
                        rs.getString("email"),
                        rs.getString("display_name"),
                        rs.getString("role"),
                        rs.getBoolean("active"),
                        rs.getTimestamp("last_login_at") == null
                                ? null
                                : rs.getTimestamp("last_login_at").toInstant().toString()
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado"));
    }

    private StaffLock lockStaff(UUID organizationId, UUID userId) {
        return jdbc.sql("""
                SELECT uo.role, uo.active
                FROM user_organizations uo WITH (UPDLOCK, HOLDLOCK)
                WHERE uo.organization_id = :organizationId AND uo.user_id = :userId
                """)
                .param("organizationId", organizationId)
                .param("userId", userId)
                .query((rs, rowNum) -> new StaffLock(
                        rs.getString("role"),
                        rs.getBoolean("active")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Usuario no encontrado"));
    }

    private void requireAnotherOwner(UUID organizationId, UUID excludedUserId) {
        int owners = jdbc.sql("""
                SELECT COUNT(*)
                FROM user_organizations WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND role = 'OWNER'
                  AND active = 1
                  AND user_id <> :excludedUserId
                """)
                .param("organizationId", organizationId)
                .param("excludedUserId", excludedUserId)
                .query(Integer.class)
                .single();
        if (owners == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La organización debe conservar al menos un propietario activo"
            );
        }
    }

    private void requireCanManage(Jwt jwt, String targetRole) {
        if (!StaffPolicy.canManage(jwt.getClaimAsString("role"), targetRole)) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "No tiene permiso para administrar este usuario"
            );
        }
    }

    private void requireAssignable(Jwt jwt, String role) {
        if (!StaffPolicy.canAssignRole(jwt.getClaimAsString("role"), role)) {
            throw new ResponseStatusException(
                    HttpStatus.FORBIDDEN,
                    "No tiene permiso para asignar este rol"
            );
        }
    }

    private void validatePassword(String password) {
        try {
            StaffPolicy.validatePassword(password);
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }
    }

    private void invalidateSessions(UUID userId) {
        jdbc.sql("""
                UPDATE app_users
                SET token_version = token_version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :userId
                """)
                .param("userId", userId)
                .update();
    }

    private record StaffLock(String role, boolean active) {
    }

    public record CreateStaffRequest(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 160) String displayName,
            @NotBlank @Size(max = 512) @JsonAlias({"password", "k"}) String credential,
            @NotBlank @Pattern(regexp = "OWNER|MANAGER|CASHIER|SERVER|KITCHEN") String role
    ) {
        @Override
        public String toString() {
            return "CreateStaffRequest[email=" + email + ", displayName=" + displayName + ", credential=[PROTECTED], role=" + role + "]";
        }
    }

    public record ChangeRoleRequest(
            @NotNull UUID userId,
            @NotBlank @Pattern(regexp = "OWNER|MANAGER|CASHIER|SERVER|KITCHEN") String role
    ) {
    }

    public record ChangeStatusRequest(@NotNull UUID userId, boolean active) {
    }

    public record ResetPasswordRequest(
            @NotNull UUID userId,
            @NotBlank @Size(max = 512) @JsonAlias({"password", "k"}) String credential
    ) {
        @Override
        public String toString() {
            return "ResetPasswordRequest[userId=" + userId + ", credential=[PROTECTED]]";
        }
    }

    public record StaffResponse(
            UUID id,
            String email,
            String displayName,
            String role,
            boolean active,
            String lastLoginAt
    ) {
    }
}
