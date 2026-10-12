package com.semaialabs.sgr.payment;

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
@RequestMapping("/api/payments")
public class PaymentController {
    private static final String CHECKOUT_ROLES =
            "hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')";

    private final JdbcClient jdbc;
    private final AuditService audit;

    public PaymentController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/summary")
    @PreAuthorize(CHECKOUT_ROLES)
    public OrderPaymentSummary summary(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID orderId
    ) {
        return findSummary(TenantContext.organizationId(jwt), orderId);
    }

    @PostMapping("/request")
    @PreAuthorize(CHECKOUT_ROLES)
    @Transactional
    public OrderPaymentSummary requestPayment(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody RequestPaymentRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        OrderLock order = lockOrder(organizationId, request.orderId());
        if ("WAITING_PAYMENT".equals(order.status())) {
            return findSummary(organizationId, request.orderId());
        }
        if (!"OPEN".equals(order.status()) || order.closedAt() != null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El pedido no está abierto");
        }
        if (order.version() != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El pedido cambió en otro dispositivo; actualice la vista"
            );
        }

        BigDecimal total = orderTotal(organizationId, request.orderId());
        if (total.signum() <= 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El pedido no tiene productos");
        }
        int unsentItems = jdbc.sql("""
                SELECT COUNT(*)
                FROM order_items
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND voided_at IS NULL
                  AND sent_to_kitchen_at IS NULL
                """)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .query(Integer.class)
                .single();
        if (unsentItems > 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Envíe todos los productos a cocina antes de solicitar la cuenta"
            );
        }

        jdbc.sql("""
                UPDATE restaurant_orders
                SET status = 'WAITING_PAYMENT',
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :orderId
                  AND organization_id = :organizationId
                  AND status = 'OPEN'
                  AND version = :expectedVersion
                """)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        jdbc.sql("""
                UPDATE dining_tables
                SET status = 'WAITING_PAYMENT',
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :tableId
                  AND organization_id = :organizationId
                  AND status = 'OCCUPIED'
                """)
                .param("tableId", order.tableId())
                .param("organizationId", organizationId)
                .update();

        audit.record(jwt, "PAYMENT_REQUESTED", "restaurant_order", request.orderId(), Map.of());
        return findSummary(organizationId, request.orderId());
    }

    @PostMapping
    @PreAuthorize(CHECKOUT_ROLES)
    @Transactional
    public PaymentResult pay(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreatePaymentRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        OrderLock order = lockOrder(organizationId, request.orderId());
        Optional<PaymentResponse> existing = findPaymentByIdempotency(
                organizationId,
                request.idempotencyKey()
        );
        if (existing.isPresent()) {
            ensureSameRequest(existing.get(), request);
            return new PaymentResult(
                    existing.get(),
                    findSummary(organizationId, existing.get().orderId())
            );
        }

        if (!"WAITING_PAYMENT".equals(order.status()) || order.closedAt() != null) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El pedido no está pendiente de pago"
            );
        }

        BigDecimal total = orderTotal(organizationId, request.orderId());
        BigDecimal paid = paidTotal(organizationId, request.orderId());
        BigDecimal remaining = total.subtract(paid);
        PaymentPolicy.PaymentAmounts amounts;
        try {
            amounts = PaymentPolicy.validate(
                    remaining,
                    request.method(),
                    request.amount(),
                    request.tenderedAmount()
            );
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }

        UUID paymentId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO order_payments (
                    id, organization_id, location_id, order_id, method,
                    amount, tendered_amount, change_amount, external_reference,
                    idempotency_key, paid_by_user_id
                ) VALUES (
                    :id, :organizationId, :locationId, :orderId, :method,
                    :amount, :tenderedAmount, :changeAmount, :externalReference,
                    :idempotencyKey, :userId
                )
                """)
                .param("id", paymentId)
                .param("organizationId", organizationId)
                .param("locationId", order.locationId())
                .param("orderId", request.orderId())
                .param("method", request.method())
                .param("amount", amounts.amount())
                .param("tenderedAmount", amounts.tenderedAmount())
                .param("changeAmount", amounts.changeAmount())
                .param("externalReference", clean(request.externalReference()))
                .param("idempotencyKey", request.idempotencyKey())
                .param("userId", TenantContext.userId(jwt))
                .update();

        if (amounts.closesOrder()) {
            jdbc.sql("""
                    UPDATE restaurant_orders
                    SET status = 'PAID',
                        closed_at = SYSUTCDATETIME(),
                        version = version + 1,
                        updated_at = SYSUTCDATETIME()
                    WHERE id = :orderId
                      AND organization_id = :organizationId
                      AND status = 'WAITING_PAYMENT'
                    """)
                    .param("orderId", request.orderId())
                    .param("organizationId", organizationId)
                    .update();
            jdbc.sql("""
                    UPDATE dining_tables
                    SET status = 'FREE',
                        version = version + 1,
                        updated_at = SYSUTCDATETIME()
                    WHERE id = :tableId
                      AND organization_id = :organizationId
                      AND status = 'WAITING_PAYMENT'
                    """)
                    .param("tableId", order.tableId())
                    .param("organizationId", organizationId)
                    .update();
        }

        audit.record(
                jwt,
                "PAYMENT_RECORDED",
                "order_payment",
                paymentId,
                Map.of(
                        "orderId", request.orderId(),
                        "method", request.method(),
                        "amount", amounts.amount(),
                        "orderClosed", amounts.closesOrder()
                )
        );
        if (amounts.closesOrder()) {
            audit.record(jwt, "ORDER_PAID", "restaurant_order", request.orderId(), Map.of());
        }

        return new PaymentResult(
                findPayment(organizationId, paymentId),
                findSummary(organizationId, request.orderId())
        );
    }

    private OrderLock lockOrder(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT location_id, table_id, status, version, closed_at
                FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new OrderLock(
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("table_id", UUID.class),
                        rs.getString("status"),
                        rs.getLong("version"),
                        rs.getTimestamp("closed_at")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pedido no encontrado"));
    }

    private BigDecimal orderTotal(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT COALESCE(SUM(CAST(quantity * unit_price AS DECIMAL(19,4))), 0)
                FROM order_items
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND voided_at IS NULL
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query(BigDecimal.class)
                .single();
    }

    private BigDecimal paidTotal(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT COALESCE(SUM(amount), 0)
                FROM order_payments
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND status = 'COMPLETED'
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query(BigDecimal.class)
                .single();
    }

    private OrderPaymentSummary findSummary(UUID organizationId, UUID orderId) {
        OrderSummaryRow order = jdbc.sql("""
                SELECT o.order_number, o.status, o.location_id, o.table_id,
                       t.name AS table_name, a.name AS area_name
                FROM restaurant_orders o
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE o.id = :orderId AND o.organization_id = :organizationId
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new OrderSummaryRow(
                        rs.getLong("order_number"),
                        rs.getString("status"),
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("table_id", UUID.class),
                        rs.getString("table_name"),
                        rs.getString("area_name")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pedido no encontrado"));
        BigDecimal total = orderTotal(organizationId, orderId);
        BigDecimal paid = paidTotal(organizationId, orderId);
        return new OrderPaymentSummary(
                orderId,
                order.orderNumber(),
                order.status(),
                order.locationId(),
                order.tableId(),
                order.tableName(),
                order.areaName(),
                total,
                paid,
                total.subtract(paid),
                listPayments(organizationId, orderId)
        );
    }

    private Optional<PaymentResponse> findPaymentByIdempotency(
            UUID organizationId,
            UUID idempotencyKey
    ) {
        return jdbc.sql("""
                SELECT id
                FROM order_payments WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND idempotency_key = :idempotencyKey
                """)
                .param("organizationId", organizationId)
                .param("idempotencyKey", idempotencyKey)
                .query(UUID.class)
                .optional()
                .map(id -> findPayment(organizationId, id));
    }

    private List<PaymentResponse> listPayments(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT id, order_id, method, amount, tendered_amount,
                       change_amount, external_reference, idempotency_key,
                       status, paid_at
                FROM order_payments
                WHERE organization_id = :organizationId AND order_id = :orderId
                ORDER BY paid_at, id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query((rs, rowNum) -> mapPayment(rs))
                .list();
    }

    private PaymentResponse findPayment(UUID organizationId, UUID paymentId) {
        return jdbc.sql("""
                SELECT id, order_id, method, amount, tendered_amount,
                       change_amount, external_reference, idempotency_key,
                       status, paid_at
                FROM order_payments
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", paymentId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> mapPayment(rs))
                .single();
    }

    private PaymentResponse mapPayment(java.sql.ResultSet rs) throws java.sql.SQLException {
        Timestamp paidAt = rs.getTimestamp("paid_at");
        return new PaymentResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("order_id", UUID.class),
                rs.getString("method"),
                rs.getBigDecimal("amount"),
                rs.getBigDecimal("tendered_amount"),
                rs.getBigDecimal("change_amount"),
                rs.getString("external_reference"),
                rs.getObject("idempotency_key", UUID.class),
                rs.getString("status"),
                paidAt.toInstant().toString()
        );
    }

    private void ensureSameRequest(PaymentResponse existing, CreatePaymentRequest request) {
        boolean sameTendered = existing.tenderedAmount() == null
                ? request.tenderedAmount() == null
                : request.tenderedAmount() != null
                        && existing.tenderedAmount().compareTo(request.tenderedAmount()) == 0;
        if (!existing.orderId().equals(request.orderId())
                || !existing.method().equals(request.method())
                || existing.amount().compareTo(request.amount()) != 0
                || !sameTendered
                || !Objects.equals(existing.externalReference(), clean(request.externalReference()))) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La clave de idempotencia ya se usó con otros datos"
            );
        }
    }

    private String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record OrderLock(
            UUID locationId,
            UUID tableId,
            String status,
            long version,
            Timestamp closedAt
    ) {
    }

    private record OrderSummaryRow(
            long orderNumber,
            String status,
            UUID locationId,
            UUID tableId,
            String tableName,
            String areaName
    ) {
    }

    public record RequestPaymentRequest(
            @NotNull UUID orderId,
            @Min(0) long expectedVersion
    ) {
    }

    public record CreatePaymentRequest(
            @NotNull UUID orderId,
            @NotBlank @Pattern(regexp = "CASH|CARD") String method,
            @NotNull @DecimalMin("0.0001") @Digits(integer = 15, fraction = 4) BigDecimal amount,
            @Digits(integer = 15, fraction = 4) BigDecimal tenderedAmount,
            @Size(max = 120) String externalReference,
            @NotNull UUID idempotencyKey
    ) {
    }

    public record PaymentResponse(
            UUID id,
            UUID orderId,
            String method,
            BigDecimal amount,
            BigDecimal tenderedAmount,
            BigDecimal changeAmount,
            String externalReference,
            UUID idempotencyKey,
            String status,
            String paidAt
    ) {
    }

    public record OrderPaymentSummary(
            UUID orderId,
            long orderNumber,
            String status,
            UUID locationId,
            UUID tableId,
            String tableName,
            String areaName,
            BigDecimal total,
            BigDecimal paid,
            BigDecimal balance,
            List<PaymentResponse> payments
    ) {
    }

    public record PaymentResult(
            PaymentResponse payment,
            OrderPaymentSummary summary
    ) {
    }
}
