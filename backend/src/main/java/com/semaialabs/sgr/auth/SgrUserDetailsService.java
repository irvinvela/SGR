package com.semaialabs.sgr.auth;

import java.util.Locale;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

@Service
public class SgrUserDetailsService implements UserDetailsService {
    private final JdbcClient jdbc;

    public SgrUserDetailsService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        String normalizedEmail = email.trim().toLowerCase(Locale.ROOT);
        return jdbc.sql("""
                SELECT TOP 1
                    u.id,
                    u.email,
                    u.password_hash,
                    u.display_name,
                    u.active,
                    u.locked_until,
                    u.token_version,
                    o.id AS organization_id,
                    o.name AS organization_name,
                    uo.role
                FROM app_users u
                INNER JOIN user_organizations uo ON uo.user_id = u.id AND uo.active = 1
                INNER JOIN organizations o ON o.id = uo.organization_id AND o.active = 1
                WHERE u.normalized_email = :email
                ORDER BY CASE uo.role
                    WHEN 'PLATFORM_ADMIN' THEN 0
                    WHEN 'OWNER' THEN 1
                    ELSE 2
                END
                """)
                .param("email", normalizedEmail)
                .query((rs, rowNum) -> new SgrUser(
                        rs.getObject("id", UUID.class),
                        rs.getString("email"),
                        rs.getString("password_hash"),
                        rs.getString("display_name"),
                        rs.getObject("organization_id", UUID.class),
                        rs.getString("organization_name"),
                        rs.getString("role"),
                        rs.getLong("token_version"),
                        rs.getBoolean("active"),
                        rs.getTimestamp("locked_until") == null
                                || rs.getTimestamp("locked_until").toInstant().isBefore(java.time.Instant.now())
                ))
                .optional()
                .orElseThrow(() -> new UsernameNotFoundException("Credenciales inválidas"));
    }
}
