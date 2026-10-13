package com.semaialabs.sgr.kitchen;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/kitchen")
public class KitchenController {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public KitchenController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/rounds")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'KITCHEN', 'SERVER')")
    public List<KitchenRoundResponse> listActiveRounds(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        return jdbc.sql("""
                SELECT
                    r.id, r.order_id, r.round_number, r.status, r.sent_at, r.version,
                    o.order_number, t.name AS table_name, a.name AS area_name
                FROM kitchen_rounds r
                INNER JOIN restaurant_orders o ON o.id = r.order_id
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE r.organization_id = :organizationId
                  AND r.location_id = :locationId
                  AND r.status IN ('QUEUED', 'PREPARING', 'READY')
                ORDER BY r.sent_at
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new KitchenRoundResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getInt("round_number"),
                        rs.getString("status"),
                        rs.getTimestamp("sent_at").toInstant().toString(),
                        listItems(organizationId, rs.getObject("id", UUID.class)),
                        rs.getLong("version")
                ))
                .list();
    }

    @PatchMapping("/rounds/status")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'KITCHEN')")
    @Transactional
    public KitchenRoundResponse changeStatus(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangeRoundStatusRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        String currentStatus = jdbc.sql("""
                SELECT status
                FROM kitchen_rounds WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", request.roundId())
                .param("organizationId", organizationId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Ronda no encontrada"));
        if (!KitchenStatusPolicy.allows(currentStatus, request.status())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Transición de cocina no permitida"
            );
        }

        int updated = jdbc.sql("""
                UPDATE kitchen_rounds
                SET status = :status,
                    preparing_at = CASE WHEN :status = 'PREPARING' THEN SYSUTCDATETIME() ELSE preparing_at END,
                    ready_at = CASE WHEN :status = 'READY' THEN SYSUTCDATETIME() ELSE ready_at END,
                    completed_at = CASE WHEN :status = 'COMPLETED' THEN SYSUTCDATETIME() ELSE completed_at END,
                    version = version + 1
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND status = :currentStatus
                """)
                .param("status", request.status())
                .param("id", request.roundId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .param("currentStatus", currentStatus)
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La ronda cambió en otro dispositivo; actualice la vista"
            );
        }

        audit.record(
                jwt, "KITCHEN_ROUND_STATUS_CHANGED", "kitchen_round", request.roundId(),
                Map.of("status", request.status())
        );
        return findRound(organizationId, request.roundId());
    }

    private KitchenRoundResponse findRound(UUID organizationId, UUID roundId) {
        return jdbc.sql("""
                SELECT
                    r.id, r.order_id, r.round_number, r.status, r.sent_at, r.version,
                    o.order_number, t.name AS table_name, a.name AS area_name
                FROM kitchen_rounds r
                INNER JOIN restaurant_orders o ON o.id = r.order_id
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE r.id = :id AND r.organization_id = :organizationId
                """)
                .param("id", roundId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new KitchenRoundResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getInt("round_number"),
                        rs.getString("status"),
                        rs.getTimestamp("sent_at").toInstant().toString(),
                        listItems(organizationId, roundId),
                        rs.getLong("version")
                ))
                .single();
    }

    private List<KitchenItemResponse> listItems(UUID organizationId, UUID roundId) {
        return jdbc.sql("""
                SELECT i.id, i.product_name, i.quantity, i.kitchen_note,
                       i.voided_at, i.void_reason
                FROM kitchen_round_items ri
                INNER JOIN order_items i ON i.id = ri.order_item_id
                WHERE ri.round_id = :roundId AND i.organization_id = :organizationId
                ORDER BY i.created_at, i.id
                """)
                .param("roundId", roundId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new KitchenItemResponse(
                        rs.getObject("id", UUID.class),
                        rs.getString("product_name"),
                        rs.getBigDecimal("quantity"),
                        rs.getString("kitchen_note"),
                        rs.getTimestamp("voided_at") != null,
                        rs.getString("void_reason")
                ))
                .list();
    }

    public record ChangeRoundStatusRequest(
            @NotNull UUID roundId,
            @NotBlank @Pattern(regexp = "PREPARING|READY|COMPLETED") String status,
            @Min(0) long expectedVersion
    ) {
    }

    public record KitchenItemResponse(
            UUID id,
            String productName,
            BigDecimal quantity,
            String kitchenNote,
            boolean voided,
            String voidReason
    ) {
    }

    public record KitchenRoundResponse(
            UUID id,
            UUID orderId,
            long orderNumber,
            String tableName,
            String areaName,
            int roundNumber,
            String status,
            String sentAt,
            List<KitchenItemResponse> items,
            long version
    ) {
    }
}
