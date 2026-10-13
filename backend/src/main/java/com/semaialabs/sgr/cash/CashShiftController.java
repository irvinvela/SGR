package com.semaialabs.sgr.cash;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/cash-shifts")
public class CashShiftController {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public CashShiftController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/current")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')")
    public CurrentShiftResponse current(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        Optional<UUID> shiftId = jdbc.sql("""
                SELECT id
                FROM cash_shifts
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND status = 'OPEN'
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query(UUID.class)
                .optional();
        return new CurrentShiftResponse(
                shiftId.map(id -> findShift(organizationId, id)).orElse(null)
        );
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER')")
    public List<CashShiftResponse> history(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        return jdbc.sql("""
                SELECT TOP (20) id
                FROM cash_shifts
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                ORDER BY opened_at DESC
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query(UUID.class)
                .list()
                .stream()
                .map(id -> findShift(organizationId, id))
                .toList();
    }

    @PostMapping("/open")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER')")
    @Transactional
    public CashShiftResponse open(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody OpenShiftRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        Optional<UUID> existing = findShiftByIdempotency(
                organizationId,
                request.idempotencyKey()
        );
        if (existing.isPresent()) {
            CashShiftResponse shift = findShift(organizationId, existing.get());
            if (!shift.locationId().equals(request.locationId())
                    || shift.openingAmount().compareTo(request.openingAmount()) != 0) {
                throw idempotencyConflict();
            }
            return shift;
        }

        lockLocation(organizationId, request.locationId());
        Optional<UUID> active = jdbc.sql("""
                SELECT id
                FROM cash_shifts WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND status = 'OPEN'
                """)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .query(UUID.class)
                .optional();
        if (active.isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Ya existe un turno abierto");
        }

        UUID shiftId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO cash_shifts (
                    id, organization_id, location_id, opening_amount,
                    opened_by_user_id, idempotency_key
                ) VALUES (
                    :id, :organizationId, :locationId, :openingAmount,
                    :userId, :idempotencyKey
                )
                """)
                .param("id", shiftId)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("openingAmount", request.openingAmount())
                .param("userId", TenantContext.userId(jwt))
                .param("idempotencyKey", request.idempotencyKey())
                .update();
        audit.record(
                jwt,
                "CASH_SHIFT_OPENED",
                "cash_shift",
                shiftId,
                Map.of("openingAmount", request.openingAmount())
        );
        return findShift(organizationId, shiftId);
    }

    @PostMapping("/movements")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER')")
    @Transactional
    public CashShiftResponse movement(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateMovementRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        Optional<MovementResponse> existing = findMovementByIdempotency(
                organizationId,
                request.idempotencyKey()
        );
        if (existing.isPresent()) {
            ensureSameMovement(existing.get(), request);
            return findShift(organizationId, existing.get().cashShiftId());
        }

        ShiftLock shift = lockShift(organizationId, request.cashShiftId());
        if (!"OPEN".equals(shift.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El turno de caja está cerrado");
        }
        if ("PAID_OUT".equals(request.type())) {
            ShiftTotals totals = calculateTotals(organizationId, request.cashShiftId());
            BigDecimal availableCash = shift.openingAmount()
                    .add(totals.cashSales())
                    .subtract(totals.cashRefunds())
                    .add(totals.paidIn())
                    .subtract(totals.paidOut());
            if (request.amount().compareTo(availableCash) > 0) {
                throw new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "La salida supera el efectivo esperado en caja"
                );
            }
        }
        UUID movementId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO cash_movements (
                    id, organization_id, location_id, cash_shift_id,
                    type, amount, reason, idempotency_key, created_by_user_id
                ) VALUES (
                    :id, :organizationId, :locationId, :shiftId,
                    :type, :amount, :reason, :idempotencyKey, :userId
                )
                """)
                .param("id", movementId)
                .param("organizationId", organizationId)
                .param("locationId", shift.locationId())
                .param("shiftId", request.cashShiftId())
                .param("type", request.type())
                .param("amount", request.amount())
                .param("reason", request.reason().trim())
                .param("idempotencyKey", request.idempotencyKey())
                .param("userId", TenantContext.userId(jwt))
                .update();
        jdbc.sql("""
                UPDATE cash_shifts
                SET version = version + 1
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", request.cashShiftId())
                .param("organizationId", organizationId)
                .update();
        audit.record(
                jwt,
                "CASH_MOVEMENT_RECORDED",
                "cash_movement",
                movementId,
                Map.of("type", request.type(), "amount", request.amount())
        );
        return findShift(organizationId, request.cashShiftId());
    }

    @PostMapping("/close")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER')")
    @Transactional
    public CashShiftResponse close(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CloseShiftRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        ShiftLock shift = lockShift(organizationId, request.cashShiftId());
        if ("CLOSED".equals(shift.status())) {
            return findShift(organizationId, request.cashShiftId());
        }
        if (shift.version() != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El turno cambió en otro dispositivo; actualice la vista"
            );
        }

        int activeOrders = jdbc.sql("""
                SELECT COUNT(*)
                FROM restaurant_orders
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND closed_at IS NULL
                """)
                .param("organizationId", organizationId)
                .param("locationId", shift.locationId())
                .query(Integer.class)
                .single();
        if (activeOrders > 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "No se puede cerrar caja mientras existan pedidos abiertos"
            );
        }

        ShiftTotals totals = calculateTotals(organizationId, request.cashShiftId());
        CashShiftPolicy.Reconciliation reconciliation;
        try {
            reconciliation = CashShiftPolicy.reconcile(
                    shift.openingAmount(),
                    totals.cashSales(),
                    totals.cashRefunds(),
                    totals.paidIn(),
                    totals.paidOut(),
                    request.countedCash()
            );
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }

        jdbc.sql("""
                UPDATE cash_shifts
                SET status = 'CLOSED',
                    closing_counted_cash = :countedCash,
                    expected_cash = :expectedCash,
                    cash_difference = :difference,
                    cash_sales_total = :cashSales,
                    card_sales_total = :cardSales,
                    cash_refunds_total = :cashRefunds,
                    card_refunds_total = :cardRefunds,
                    paid_in_total = :paidIn,
                    paid_out_total = :paidOut,
                    closed_by_user_id = :userId,
                    closed_at = SYSUTCDATETIME(),
                    closing_note = :closingNote,
                    version = version + 1
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND status = 'OPEN'
                  AND version = :expectedVersion
                """)
                .param("countedCash", request.countedCash())
                .param("expectedCash", reconciliation.expectedCash())
                .param("difference", reconciliation.difference())
                .param("cashSales", totals.cashSales())
                .param("cardSales", totals.cardSales())
                .param("cashRefunds", totals.cashRefunds())
                .param("cardRefunds", totals.cardRefunds())
                .param("paidIn", totals.paidIn())
                .param("paidOut", totals.paidOut())
                .param("userId", TenantContext.userId(jwt))
                .param("closingNote", clean(request.closingNote()))
                .param("id", request.cashShiftId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        audit.record(
                jwt,
                "CASH_SHIFT_CLOSED",
                "cash_shift",
                request.cashShiftId(),
                Map.of(
                        "expectedCash", reconciliation.expectedCash(),
                        "countedCash", request.countedCash(),
                        "difference", reconciliation.difference()
                )
        );
        return findShift(organizationId, request.cashShiftId());
    }

    private CashShiftResponse findShift(UUID organizationId, UUID shiftId) {
        ShiftRow row = jdbc.sql("""
                SELECT s.id, s.location_id, s.status, s.opening_amount,
                       s.opened_at, opener.display_name AS opened_by,
                       s.closing_counted_cash, s.expected_cash, s.cash_difference,
                       s.cash_sales_total, s.card_sales_total,
                       COALESCE(s.cash_refunds_total, 0) AS cash_refunds_total,
                       COALESCE(s.card_refunds_total, 0) AS card_refunds_total,
                       s.paid_in_total, s.paid_out_total,
                       s.closed_at, closer.display_name AS closed_by,
                       s.closing_note, s.version
                FROM cash_shifts s
                INNER JOIN app_users opener ON opener.id = s.opened_by_user_id
                LEFT JOIN app_users closer ON closer.id = s.closed_by_user_id
                WHERE s.id = :id AND s.organization_id = :organizationId
                """)
                .param("id", shiftId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new ShiftRow(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("status"),
                        rs.getBigDecimal("opening_amount"),
                        rs.getTimestamp("opened_at"),
                        rs.getString("opened_by"),
                        rs.getBigDecimal("closing_counted_cash"),
                        rs.getBigDecimal("expected_cash"),
                        rs.getBigDecimal("cash_difference"),
                        rs.getBigDecimal("cash_sales_total"),
                        rs.getBigDecimal("card_sales_total"),
                        rs.getBigDecimal("cash_refunds_total"),
                        rs.getBigDecimal("card_refunds_total"),
                        rs.getBigDecimal("paid_in_total"),
                        rs.getBigDecimal("paid_out_total"),
                        rs.getTimestamp("closed_at"),
                        rs.getString("closed_by"),
                        rs.getString("closing_note"),
                        rs.getLong("version")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Turno no encontrado"));

        ShiftTotals totals = "OPEN".equals(row.status())
                ? calculateTotals(organizationId, shiftId)
                : new ShiftTotals(
                        row.cashSalesTotal(),
                        row.cardSalesTotal(),
                        row.cashRefundsTotal(),
                        row.cardRefundsTotal(),
                        row.paidInTotal(),
                        row.paidOutTotal()
                );
        BigDecimal expectedCash = "OPEN".equals(row.status())
                ? row.openingAmount()
                        .add(totals.cashSales())
                        .subtract(totals.cashRefunds())
                        .add(totals.paidIn())
                        .subtract(totals.paidOut())
                : row.expectedCash();
        return new CashShiftResponse(
                row.id(),
                row.locationId(),
                row.status(),
                row.openingAmount(),
                row.openedBy(),
                row.openedAt().toInstant().toString(),
                totals.cashSales(),
                totals.cardSales(),
                totals.cashRefunds(),
                totals.cardRefunds(),
                totals.paidIn(),
                totals.paidOut(),
                expectedCash,
                row.closingCountedCash(),
                row.cashDifference(),
                row.closedBy(),
                row.closedAt() == null ? null : row.closedAt().toInstant().toString(),
                row.closingNote(),
                row.version(),
                listMovements(organizationId, shiftId)
        );
    }

    private ShiftTotals calculateTotals(UUID organizationId, UUID shiftId) {
        return jdbc.sql("""
                SELECT
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.cash_shift_id = :shiftId
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CASH'
                    ), 0) AS cash_sales,
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.cash_shift_id = :shiftId
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CARD'
                    ), 0) AS card_sales,
                    COALESCE((
                        SELECT SUM(r.amount)
                        FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.cash_shift_id = :shiftId
                          AND r.method = 'CASH'
                    ), 0) AS cash_refunds,
                    COALESCE((
                        SELECT SUM(r.amount)
                        FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.cash_shift_id = :shiftId
                          AND r.method = 'CARD'
                    ), 0) AS card_refunds,
                    COALESCE((
                        SELECT SUM(m.amount)
                        FROM cash_movements m
                        WHERE m.organization_id = :organizationId
                          AND m.cash_shift_id = :shiftId
                          AND m.type = 'PAID_IN'
                    ), 0) AS paid_in,
                    COALESCE((
                        SELECT SUM(m.amount)
                        FROM cash_movements m
                        WHERE m.organization_id = :organizationId
                          AND m.cash_shift_id = :shiftId
                          AND m.type = 'PAID_OUT'
                    ), 0) AS paid_out
                """)
                .param("organizationId", organizationId)
                .param("shiftId", shiftId)
                .query((rs, rowNum) -> new ShiftTotals(
                        rs.getBigDecimal("cash_sales"),
                        rs.getBigDecimal("card_sales"),
                        rs.getBigDecimal("cash_refunds"),
                        rs.getBigDecimal("card_refunds"),
                        rs.getBigDecimal("paid_in"),
                        rs.getBigDecimal("paid_out")
                ))
                .single();
    }

    private List<MovementResponse> listMovements(UUID organizationId, UUID shiftId) {
        return jdbc.sql("""
                SELECT id, cash_shift_id, type, amount, reason,
                       idempotency_key, created_at
                FROM cash_movements
                WHERE organization_id = :organizationId
                  AND cash_shift_id = :shiftId
                ORDER BY created_at, id
                """)
                .param("organizationId", organizationId)
                .param("shiftId", shiftId)
                .query((rs, rowNum) -> mapMovement(rs))
                .list();
    }

    private Optional<MovementResponse> findMovementByIdempotency(
            UUID organizationId,
            UUID idempotencyKey
    ) {
        return jdbc.sql("""
                SELECT id, cash_shift_id, type, amount, reason,
                       idempotency_key, created_at
                FROM cash_movements WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND idempotency_key = :idempotencyKey
                """)
                .param("organizationId", organizationId)
                .param("idempotencyKey", idempotencyKey)
                .query((rs, rowNum) -> mapMovement(rs))
                .optional();
    }

    private MovementResponse mapMovement(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new MovementResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("cash_shift_id", UUID.class),
                rs.getString("type"),
                rs.getBigDecimal("amount"),
                rs.getString("reason"),
                rs.getObject("idempotency_key", UUID.class),
                rs.getTimestamp("created_at").toInstant().toString()
        );
    }

    private Optional<UUID> findShiftByIdempotency(UUID organizationId, UUID idempotencyKey) {
        return jdbc.sql("""
                SELECT id
                FROM cash_shifts WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND idempotency_key = :idempotencyKey
                """)
                .param("organizationId", organizationId)
                .param("idempotencyKey", idempotencyKey)
                .query(UUID.class)
                .optional();
    }

    private ShiftLock lockShift(UUID organizationId, UUID shiftId) {
        return jdbc.sql("""
                SELECT location_id, status, opening_amount, version
                FROM cash_shifts WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", shiftId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new ShiftLock(
                        rs.getObject("location_id", UUID.class),
                        rs.getString("status"),
                        rs.getBigDecimal("opening_amount"),
                        rs.getLong("version")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Turno no encontrado"));
    }

    private void requireLocation(UUID organizationId, UUID locationId) {
        boolean exists = jdbc.sql("""
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM locations
                    WHERE id = :locationId
                      AND organization_id = :organizationId
                      AND active = 1
                ) THEN 1 ELSE 0 END
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query(Boolean.class)
                .single();
        if (!exists) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado");
        }
    }

    private void lockLocation(UUID organizationId, UUID locationId) {
        boolean exists = jdbc.sql("""
                SELECT active
                FROM locations WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :locationId AND organization_id = :organizationId
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query(Boolean.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado"));
        if (!exists) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado");
        }
    }

    private void ensureSameMovement(MovementResponse existing, CreateMovementRequest request) {
        if (!existing.cashShiftId().equals(request.cashShiftId())
                || !existing.type().equals(request.type())
                || existing.amount().compareTo(request.amount()) != 0
                || !Objects.equals(existing.reason(), request.reason().trim())) {
            throw idempotencyConflict();
        }
    }

    private ResponseStatusException idempotencyConflict() {
        return new ResponseStatusException(
                HttpStatus.CONFLICT,
                "La clave de idempotencia ya se usó con otros datos"
        );
    }

    private String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record ShiftLock(
            UUID locationId,
            String status,
            BigDecimal openingAmount,
            long version
    ) {
    }

    private record ShiftTotals(
            BigDecimal cashSales,
            BigDecimal cardSales,
            BigDecimal cashRefunds,
            BigDecimal cardRefunds,
            BigDecimal paidIn,
            BigDecimal paidOut
    ) {
    }

    private record ShiftRow(
            UUID id,
            UUID locationId,
            String status,
            BigDecimal openingAmount,
            Timestamp openedAt,
            String openedBy,
            BigDecimal closingCountedCash,
            BigDecimal expectedCash,
            BigDecimal cashDifference,
            BigDecimal cashSalesTotal,
            BigDecimal cardSalesTotal,
            BigDecimal cashRefundsTotal,
            BigDecimal cardRefundsTotal,
            BigDecimal paidInTotal,
            BigDecimal paidOutTotal,
            Timestamp closedAt,
            String closedBy,
            String closingNote,
            long version
    ) {
    }

    public record OpenShiftRequest(
            @NotNull UUID locationId,
            @NotNull @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal openingAmount,
            @NotNull UUID idempotencyKey
    ) {
    }

    public record CreateMovementRequest(
            @NotNull UUID cashShiftId,
            @NotBlank @Pattern(regexp = "PAID_IN|PAID_OUT") String type,
            @NotNull @DecimalMin("0.0001") @Digits(integer = 15, fraction = 4) BigDecimal amount,
            @NotBlank @Size(max = 240) String reason,
            @NotNull UUID idempotencyKey
    ) {
    }

    public record CloseShiftRequest(
            @NotNull UUID cashShiftId,
            @NotNull @DecimalMin("0") @Digits(integer = 15, fraction = 4) BigDecimal countedCash,
            @Size(max = 500) String closingNote,
            @Min(0) long expectedVersion
    ) {
    }

    public record CurrentShiftResponse(CashShiftResponse shift) {
    }

    public record MovementResponse(
            UUID id,
            UUID cashShiftId,
            String type,
            BigDecimal amount,
            String reason,
            UUID idempotencyKey,
            String createdAt
    ) {
    }

    public record CashShiftResponse(
            UUID id,
            UUID locationId,
            String status,
            BigDecimal openingAmount,
            String openedBy,
            String openedAt,
            BigDecimal cashSales,
            BigDecimal cardSales,
            BigDecimal cashRefunds,
            BigDecimal cardRefunds,
            BigDecimal paidIn,
            BigDecimal paidOut,
            BigDecimal expectedCash,
            BigDecimal closingCountedCash,
            BigDecimal cashDifference,
            String closedBy,
            String closedAt,
            String closingNote,
            long version,
            List<MovementResponse> movements
    ) {
    }
}
