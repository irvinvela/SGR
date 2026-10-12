package com.semaialabs.sgr.dining;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/dining")
public class DiningController {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public DiningController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/areas")
    public List<AreaResponse> listAreas(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        return jdbc.sql("""
                SELECT id, location_id, name, sort_order
                FROM dining_areas
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                ORDER BY sort_order, name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new AreaResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("name"),
                        rs.getInt("sort_order")
                ))
                .list();
    }

    @PostMapping("/areas")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public AreaResponse createArea(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateAreaRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, request.locationId());
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO dining_areas (
                    id, organization_id, location_id, name, sort_order
                ) VALUES (
                    :id, :organizationId, :locationId, :name, :sortOrder
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("name", request.name().trim())
                .param("sortOrder", request.sortOrder())
                .update();
        audit.record(jwt, "DINING_AREA_CREATED", "dining_area", id, Map.of("name", request.name().trim()));
        return new AreaResponse(id, request.locationId(), request.name().trim(), request.sortOrder());
    }

    @GetMapping("/tables")
    public List<TableResponse> listTables(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        return jdbc.sql("""
                SELECT
                    t.id, t.location_id, t.area_id, a.name AS area_name,
                    t.code, t.name, t.capacity, t.status, t.version
                FROM dining_tables t
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE t.organization_id = :organizationId
                  AND t.location_id = :locationId
                  AND t.active = 1
                  AND a.active = 1
                ORDER BY a.sort_order, a.name, t.code
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new TableResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("area_id", UUID.class),
                        rs.getString("area_name"),
                        rs.getString("code"),
                        rs.getString("name"),
                        rs.getInt("capacity"),
                        rs.getString("status"),
                        rs.getLong("version")
                ))
                .list();
    }

    @PostMapping("/tables")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public TableResponse createTable(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateTableRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireArea(organizationId, request.locationId(), request.areaId());
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO dining_tables (
                    id, organization_id, location_id, area_id,
                    code, name, capacity
                ) VALUES (
                    :id, :organizationId, :locationId, :areaId,
                    :code, :name, :capacity
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("areaId", request.areaId())
                .param("code", normalizeCode(request.code()))
                .param("name", request.name().trim())
                .param("capacity", request.capacity())
                .update();
        String areaName = areaName(request.areaId());
        audit.record(jwt, "DINING_TABLE_CREATED", "dining_table", id, Map.of("code", normalizeCode(request.code())));
        return new TableResponse(
                id, request.locationId(), request.areaId(), areaName,
                normalizeCode(request.code()), request.name().trim(),
                request.capacity(), "FREE", 0
        );
    }

    @PatchMapping("/tables/status")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')")
    @Transactional
    public TableResponse changeTableStatus(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangeTableStatusRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        int updated = jdbc.sql("""
                UPDATE dining_tables
                SET status = :status,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND active = 1
                """)
                .param("status", request.status())
                .param("id", request.tableId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La mesa cambió en otro dispositivo; actualice la vista"
            );
        }
        audit.record(
                jwt, "DINING_TABLE_STATUS_CHANGED", "dining_table", request.tableId(),
                Map.of("status", request.status())
        );
        return findTable(organizationId, request.tableId());
    }

    private void requireLocation(UUID organizationId, UUID locationId) {
        int count = jdbc.sql("""
                SELECT COUNT(*)
                FROM locations
                WHERE id = :locationId AND organization_id = :organizationId AND active = 1
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query(Integer.class)
                .single();
        if (count == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado");
        }
    }

    private void requireArea(UUID organizationId, UUID locationId, UUID areaId) {
        int count = jdbc.sql("""
                SELECT COUNT(*)
                FROM dining_areas
                WHERE id = :areaId
                  AND organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                """)
                .param("areaId", areaId)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query(Integer.class)
                .single();
        if (count == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Salón no encontrado");
        }
    }

    private String areaName(UUID areaId) {
        return jdbc.sql("SELECT name FROM dining_areas WHERE id = :id")
                .param("id", areaId)
                .query(String.class)
                .single();
    }

    private TableResponse findTable(UUID organizationId, UUID tableId) {
        return jdbc.sql("""
                SELECT
                    t.id, t.location_id, t.area_id, a.name AS area_name,
                    t.code, t.name, t.capacity, t.status, t.version
                FROM dining_tables t
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE t.id = :id AND t.organization_id = :organizationId
                """)
                .param("id", tableId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new TableResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("area_id", UUID.class),
                        rs.getString("area_name"),
                        rs.getString("code"),
                        rs.getString("name"),
                        rs.getInt("capacity"),
                        rs.getString("status"),
                        rs.getLong("version")
                ))
                .single();
    }

    private String normalizeCode(String value) {
        return value.trim().toUpperCase(java.util.Locale.ROOT);
    }

    public record CreateAreaRequest(
            @NotNull UUID locationId,
            @NotBlank @Size(max = 100) String name,
            @Min(0) int sortOrder
    ) {
    }

    public record CreateTableRequest(
            @NotNull UUID locationId,
            @NotNull UUID areaId,
            @NotBlank @Size(max = 40) String code,
            @NotBlank @Size(max = 100) String name,
            @Min(1) @Max(100) int capacity
    ) {
    }

    public record ChangeTableStatusRequest(
            @NotNull UUID tableId,
            @NotBlank @Pattern(regexp = "FREE|OCCUPIED|WAITING_PAYMENT|OUT_OF_SERVICE") String status,
            @Min(0) long expectedVersion
    ) {
    }

    public record AreaResponse(UUID id, UUID locationId, String name, int sortOrder) {
    }

    public record TableResponse(
            UUID id,
            UUID locationId,
            UUID areaId,
            String areaName,
            String code,
            String name,
            int capacity,
            String status,
            long version
    ) {
    }
}
