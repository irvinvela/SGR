package com.semaialabs.sgr.migration;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name = "sgr.admin.membership.email")
public class OrganizationAccessRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(OrganizationAccessRunner.class);
    private static final Set<String> ROLES =
            Set.of("OWNER", "MANAGER", "CASHIER", "SERVER", "KITCHEN");

    private final Environment environment;
    private final NamedParameterJdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ConfigurableApplicationContext applicationContext;

    public OrganizationAccessRunner(
            Environment environment,
            DataSource dataSource,
            TransactionTemplate transaction,
            ConfigurableApplicationContext applicationContext
    ) {
        this.environment = environment;
        this.jdbc = new NamedParameterJdbcTemplate(dataSource);
        this.transaction = transaction;
        this.applicationContext = applicationContext;
    }

    @Override
    public void run(ApplicationArguments args) {
        String email = required("sgr.admin.membership.email").toLowerCase(Locale.ROOT);
        String organizationSlug = required("sgr.admin.membership.organization-slug");
        String role = environment.getProperty("sgr.admin.membership.role", "OWNER")
                .trim().toUpperCase(Locale.ROOT);
        boolean exclusive = environment.getProperty(
                "sgr.admin.membership.exclusive",
                Boolean.class,
                true
        );
        if (!ROLES.contains(role)) {
            throw new IllegalArgumentException("Rol no soportado: " + role);
        }

        try {
            transaction.executeWithoutResult(status -> grant(email, organizationSlug, role, exclusive));
            verify(email, organizationSlug, role, exclusive);
        } finally {
            SpringApplication.exit(applicationContext);
        }
    }

    private void grant(String email, String organizationSlug, String role, boolean exclusive) {
        UUID userId = jdbc.queryForObject("""
                SELECT id FROM app_users WHERE normalized_email = :email
                """, params("email", email), UUID.class);
        UUID organizationId = jdbc.queryForObject("""
                SELECT id FROM organizations WHERE slug = :slug AND active = 1
                """, params("slug", organizationSlug), UUID.class);
        if (userId == null || organizationId == null) {
            throw new IllegalStateException("No se encontró el usuario o la organización");
        }

        if (exclusive) {
            jdbc.update("""
                    UPDATE user_organizations
                    SET active = 0
                    WHERE user_id = :userId
                      AND organization_id <> :organizationId
                      AND active = 1
                    """, params("userId", userId, "organizationId", organizationId));
        }

        int updated = jdbc.update("""
                UPDATE user_organizations
                SET role = :role, active = 1
                WHERE user_id = :userId AND organization_id = :organizationId
                """, params(
                "userId", userId, "organizationId", organizationId, "role", role
        ));
        if (updated == 0) {
            jdbc.update("""
                    INSERT INTO user_organizations (
                        user_id, organization_id, role, active
                    ) VALUES (
                        :userId, :organizationId, :role, 1
                    )
                    """, params(
                    "userId", userId, "organizationId", organizationId, "role", role
            ));
        }

        jdbc.update("""
                UPDATE app_users
                SET token_version = token_version + 1,
                    failed_login_attempts = 0,
                    locked_until = NULL,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :userId
                """, params("userId", userId));
        jdbc.update("""
                INSERT INTO audit_events (
                    organization_id, actor_user_id, event_type, entity_type,
                    entity_id, details_json
                ) VALUES (
                    :organizationId, :userId, 'ADMIN_MEMBERSHIP_GRANTED',
                    'user_organization', :entityId, :details
                )
                """, params(
                "organizationId", organizationId,
                "userId", userId,
                "entityId", userId + ":" + organizationId,
                "details", "{\"role\":\"" + role + "\",\"exclusive\":" + exclusive + "}"
        ));
    }

    private void verify(String email, String organizationSlug, String role, boolean exclusive) {
        Map<String, Object> result = jdbc.queryForMap("""
                SELECT
                    u.id AS user_id,
                    o.id AS organization_id,
                    uo.role,
                    (
                        SELECT COUNT(*)
                        FROM user_organizations active_membership
                        WHERE active_membership.user_id = u.id
                          AND active_membership.active = 1
                    ) AS active_memberships
                FROM app_users u
                INNER JOIN user_organizations uo
                    ON uo.user_id = u.id AND uo.active = 1
                INNER JOIN organizations o
                    ON o.id = uo.organization_id AND o.active = 1
                WHERE u.normalized_email = :email AND o.slug = :slug
                """, params("email", email, "slug", organizationSlug));
        int activeMemberships = ((Number) result.get("active_memberships")).intValue();
        if (!role.equals(result.get("role")) || exclusive && activeMemberships != 1) {
            throw new IllegalStateException("No se pudo verificar el acceso solicitado");
        }
        log.info(
                "ORGANIZATION_ACCESS_VERIFIED email={} organization={} role={} activeMemberships={}",
                email, organizationSlug, role, activeMemberships
        );
    }

    private String required(String name) {
        String value = environment.getProperty(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Falta " + name);
        }
        return value.trim();
    }

    private static MapSqlParameterSource params(Object... entries) {
        MapSqlParameterSource result = new MapSqlParameterSource();
        for (int index = 0; index < entries.length; index += 2) {
            result.addValue((String) entries[index], entries[index + 1]);
        }
        return result;
    }
}
