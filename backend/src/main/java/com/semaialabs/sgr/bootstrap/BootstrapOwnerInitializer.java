package com.semaialabs.sgr.bootstrap;

import com.semaialabs.sgr.config.BootstrapProperties;
import java.text.Normalizer;
import java.util.Locale;
import java.util.UUID;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class BootstrapOwnerInitializer implements ApplicationRunner {
    private final JdbcClient jdbc;
    private final PasswordEncoder passwordEncoder;
    private final BootstrapProperties properties;

    public BootstrapOwnerInitializer(
            JdbcClient jdbc,
            PasswordEncoder passwordEncoder,
            BootstrapProperties properties
    ) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!properties.isConfigured()) {
            return;
        }

        String normalizedEmail = properties.ownerEmail().trim().toLowerCase(Locale.ROOT);
        boolean alreadyExists = jdbc.sql("SELECT COUNT(*) FROM app_users WHERE normalized_email = :email")
                .param("email", normalizedEmail)
                .query(Integer.class)
                .single() > 0;
        if (alreadyExists) {
            return;
        }

        UUID organizationId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String slug = slugify(properties.organizationName()) + "-" + organizationId.toString().substring(0, 8);

        jdbc.sql("""
                INSERT INTO organizations (id, name, slug)
                VALUES (:id, :name, :slug)
                """)
                .param("id", organizationId)
                .param("name", properties.organizationName().trim())
                .param("slug", slug)
                .update();

        jdbc.sql("""
                INSERT INTO locations (id, organization_id, name, code)
                VALUES (:id, :organizationId, :name, 'MAIN')
                """)
                .param("id", UUID.randomUUID())
                .param("organizationId", organizationId)
                .param("name", "Local principal")
                .update();

        jdbc.sql("""
                INSERT INTO app_users (
                    id, email, normalized_email, password_hash, display_name
                ) VALUES (
                    :id, :email, :normalizedEmail, :passwordHash, :displayName
                )
                """)
                .param("id", userId)
                .param("email", properties.ownerEmail().trim())
                .param("normalizedEmail", normalizedEmail)
                .param("passwordHash", passwordEncoder.encode(properties.ownerPassword()))
                .param("displayName", properties.ownerName().trim())
                .update();

        jdbc.sql("""
                INSERT INTO user_organizations (user_id, organization_id, role)
                VALUES (:userId, :organizationId, 'OWNER')
                """)
                .param("userId", userId)
                .param("organizationId", organizationId)
                .update();
    }

    private String slugify(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-|-$)", "");
    }
}
