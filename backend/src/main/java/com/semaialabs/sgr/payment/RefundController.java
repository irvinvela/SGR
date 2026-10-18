package com.semaialabs.sgr.payment;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/refunds")
public class RefundController {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public RefundController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public RefundResult refund(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateRefundRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        Optional<RefundResponse> existing = findByIdempotency(
                organizationId,
                request.idempotencyKey()
        );
        if (existing.isPresent()) {
            ensureSameRequest(existing.get(), request);
            return resultFor(organizationId, existing.get());
        }

        UUID cashShiftId = lockOpenShiftForPayment(organizationId, request.paymentId());
        PaymentLock payment = lockPayment(organizationId, request.paymentId());
        if (!"COMPLETED".equals(payment.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "El pago no admite reembolsos");
        }
        BigDecimal alreadyRefunded = refundedForPayment(organizationId, request.paymentId());
        RefundPolicy.RefundAmounts amounts;
        try {
            amounts = RefundPolicy.validate(payment.amount(), alreadyRefunded, request.amount());
        } catch (IllegalArgumentException error) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, error.getMessage(), error);
        }
        if ("CASH".equals(payment.method())
                && amounts.amount().compareTo(availableCash(organizationId, cashShiftId)) > 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El turno no tiene suficiente efectivo esperado para el reembolso"
            );
        }

        UUID refundId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO payment_refunds (
                    id, organization_id, location_id, order_id, payment_id,
                    cash_shift_id, method, amount, reason,
                    idempotency_key, refunded_by_user_id
                ) VALUES (
                    :id, :organizationId, :locationId, :orderId, :paymentId,
                    :cashShiftId, :method, :amount, :reason,
                    :idempotencyKey, :userId
                )
                """)
                .param("id", refundId)
                .param("organizationId", organizationId)
                .param("locationId", payment.locationId())
                .param("orderId", payment.orderId())
                .param("paymentId", request.paymentId())
                .param("cashShiftId", cashShiftId)
                .param("method", payment.method())
                .param("amount", amounts.amount())
                .param("reason", request.reason().trim())
                .param("idempotencyKey", request.idempotencyKey())
                .param("userId", TenantContext.userId(jwt))
                .update();
        jdbc.sql("""
                UPDATE cash_shifts
                SET version = version + 1
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND status = 'OPEN'
                """)
                .param("id", cashShiftId)
                .param("organizationId", organizationId)
                .update();

        updateClosedOrderStatus(organizationId, payment.orderId());
        audit.record(
                jwt,
                "PAYMENT_REFUNDED",
                "payment_refund",
                refundId,
                Map.of(
                        "paymentId", request.paymentId(),
                        "orderId", payment.orderId(),
                        "method", payment.method(),
                        "amount", amounts.amount(),
                        "reason", request.reason().trim()
                )
        );
        return resultFor(organizationId, findRefund(organizationId, refundId));
    }

    private void updateClosedOrderStatus(UUID organizationId, UUID orderId) {
        String currentStatus = jdbc.sql("""
                SELECT status
                FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query(String.class)
                .single();
        if (!CLOSED_ORDER_STATUSES.contains(currentStatus)) {
            return;
        }
        BigDecimal paid = paidForOrder(organizationId, orderId);
        BigDecimal refunded = refundedForOrder(organizationId, orderId);
        String nextStatus = refunded.compareTo(paid) >= 0 ? "REFUNDED" : "PARTIALLY_REFUNDED";
        jdbc.sql("""
                UPDATE restaurant_orders
                SET status = :status,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("status", nextStatus)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .update();
    }

    private RefundResult resultFor(UUID organizationId, RefundResponse refund) {
        BigDecimal paymentRefunded = refundedForPayment(organizationId, refund.paymentId());
        BigDecimal paymentAmount = jdbc.sql("""
                SELECT amount FROM order_payments
                WHERE id = :paymentId AND organization_id = :organizationId
                """)
                .param("paymentId", refund.paymentId())
                .param("organizationId", organizationId)
                .query(BigDecimal.class)
                .single();
        String orderStatus = jdbc.sql("""
                SELECT status FROM restaurant_orders
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", refund.orderId())
                .param("organizationId", organizationId)
                .query(String.class)
                .single();
        return new RefundResult(
                refund,
                paymentAmount.subtract(paymentRefunded),
                refundedForOrder(organizationId, refund.orderId()),
                orderStatus
        );
    }

    private UUID lockOpenShiftForPayment(UUID organizationId, UUID paymentId) {
        return jdbc.sql("""
                SELECT s.id
                FROM cash_shifts s WITH (UPDLOCK, HOLDLOCK)
                INNER JOIN order_payments p
                    ON p.organization_id = s.organization_id
                   AND p.location_id = s.location_id
                WHERE p.id = :paymentId
                  AND p.organization_id = :organizationId
                  AND s.status = 'OPEN'
                """)
                .param("paymentId", paymentId)
                .param("organizationId", organizationId)
                .query(UUID.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "Abra un turno de caja antes de registrar reembolsos"
                ));
    }

    private PaymentLock lockPayment(UUID organizationId, UUID paymentId) {
        return jdbc.sql("""
                SELECT order_id, location_id, method, amount, status
                FROM order_payments WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", paymentId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new PaymentLock(
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("method"),
                        rs.getBigDecimal("amount"),
                        rs.getString("status")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pago no encontrado"));
    }

    private BigDecimal paidForOrder(UUID organizationId, UUID orderId) {
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

    private BigDecimal availableCash(UUID organizationId, UUID cashShiftId) {
        return jdbc.sql("""
                SELECT
                    s.opening_amount
                    + COALESCE((
                        SELECT SUM(p.amount) FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.cash_shift_id = :cashShiftId
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CASH'
                    ), 0)
                    - COALESCE((
                        SELECT SUM(r.amount) FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.cash_shift_id = :cashShiftId
                          AND r.method = 'CASH'
                    ), 0)
                    + COALESCE((
                        SELECT SUM(m.amount) FROM cash_movements m
                        WHERE m.organization_id = :organizationId
                          AND m.cash_shift_id = :cashShiftId
                          AND m.type = 'PAID_IN'
                    ), 0)
                    - COALESCE((
                        SELECT SUM(m.amount) FROM cash_movements m
                        WHERE m.organization_id = :organizationId
                          AND m.cash_shift_id = :cashShiftId
                          AND m.type = 'PAID_OUT'
                    ), 0)
                FROM cash_shifts s
                WHERE s.id = :cashShiftId
                  AND s.organization_id = :organizationId
                  AND s.status = 'OPEN'
                """)
                .param("organizationId", organizationId)
                .param("cashShiftId", cashShiftId)
                .query(BigDecimal.class)
                .single();
    }

    private BigDecimal refundedForOrder(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT COALESCE(SUM(amount), 0)
                FROM payment_refunds
                WHERE organization_id = :organizationId AND order_id = :orderId
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query(BigDecimal.class)
                .single();
    }

    private BigDecimal refundedForPayment(UUID organizationId, UUID paymentId) {
        return jdbc.sql("""
                SELECT COALESCE(SUM(amount), 0)
                FROM payment_refunds
                WHERE organization_id = :organizationId AND payment_id = :paymentId
                """)
                .param("organizationId", organizationId)
                .param("paymentId", paymentId)
                .query(BigDecimal.class)
                .single();
    }

    private Optional<RefundResponse> findByIdempotency(
            UUID organizationId,
            UUID idempotencyKey
    ) {
        return jdbc.sql("""
                SELECT id
                FROM payment_refunds WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId
                  AND idempotency_key = :idempotencyKey
                """)
                .param("organizationId", organizationId)
                .param("idempotencyKey", idempotencyKey)
                .query(UUID.class)
                .optional()
                .map(id -> findRefund(organizationId, id));
    }

    private RefundResponse findRefund(UUID organizationId, UUID refundId) {
        return jdbc.sql("""
                SELECT id, order_id, payment_id, cash_shift_id, method,
                       amount, reason, idempotency_key, refunded_at
                FROM payment_refunds
                WHERE id = :id AND organization_id = :organizationId
                """)
                .param("id", refundId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new RefundResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("order_id", UUID.class),
                        rs.getObject("payment_id", UUID.class),
                        rs.getObject("cash_shift_id", UUID.class),
                        rs.getString("method"),
                        rs.getBigDecimal("amount"),
                        rs.getString("reason"),
                        rs.getObject("idempotency_key", UUID.class),
                        rs.getTimestamp("refunded_at").toInstant().toString()
                ))
                .single();
    }

    private void ensureSameRequest(RefundResponse existing, CreateRefundRequest request) {
        if (!existing.paymentId().equals(request.paymentId())
                || existing.amount().compareTo(request.amount()) != 0
                || !Objects.equals(existing.reason(), request.reason().trim())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La clave de idempotencia ya se usó con otros datos"
            );
        }
    }

    private static final java.util.Set<String> CLOSED_ORDER_STATUSES = java.util.Set.of(
            "PAID", "PARTIALLY_REFUNDED", "REFUNDED"
    );

    private record PaymentLock(
            UUID orderId,
            UUID locationId,
            String method,
            BigDecimal amount,
            String status
    ) {
    }

    public record CreateRefundRequest(
            @NotNull UUID paymentId,
            @NotNull @DecimalMin("0.0001") @Digits(integer = 15, fraction = 4) BigDecimal amount,
            @NotBlank @Size(max = 500) String reason,
            @NotNull UUID idempotencyKey
    ) {
    }

    public record RefundResponse(
            UUID id,
            UUID orderId,
            UUID paymentId,
            UUID cashShiftId,
            String method,
            BigDecimal amount,
            String reason,
            UUID idempotencyKey,
            String refundedAt
    ) {
    }

    public record RefundResult(
            RefundResponse refund,
            BigDecimal paymentRefundable,
            BigDecimal orderRefunded,
            String orderStatus
    ) {
    }
}
