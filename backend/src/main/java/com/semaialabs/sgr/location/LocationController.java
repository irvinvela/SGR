package com.semaialabs.sgr.location;

import com.semaialabs.sgr.tenant.TenantContext;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/locations")
public class LocationController {
    private final JdbcClient jdbc;

    public LocationController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    public List<LocationResponse> list(@AuthenticationPrincipal Jwt jwt) {
        return jdbc.sql("""
                SELECT id, name, code, timezone
                FROM locations
                WHERE organization_id = :organizationId AND active = 1
                ORDER BY name
                """)
                .param("organizationId", TenantContext.organizationId(jwt))
                .query((rs, rowNum) -> new LocationResponse(
                        rs.getObject("id", UUID.class),
                        rs.getString("name"),
                        rs.getString("code"),
                        rs.getString("timezone")
                ))
                .list();
    }

    public record LocationResponse(UUID id, String name, String code, String timezone) {
    }
}
