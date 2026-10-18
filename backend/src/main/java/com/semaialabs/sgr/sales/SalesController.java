package com.semaialabs.sgr.sales;

import com.semaialabs.sgr.tenant.TenantContext;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/sales")
public class SalesController {
    private final JdbcClient jdbc;

    public SalesController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER')")
    public DailySalesResponse dailySales(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate businessDate
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        LocationSnapshot location = requireLocation(organizationId, locationId);
        ZoneId zoneId = ZoneId.of(location.timezone());
        Instant from = businessDate.atStartOfDay(zoneId).toInstant();
        Instant to = businessDate.plusDays(1).atStartOfDay(zoneId).toInstant();

        List<SaleResponse> sales = jdbc.sql("""
                SELECT
                    o.id, o.order_number, o.closed_at,
                    t.name AS table_name, a.name AS area_name,
                    COALESCE((
                        SELECT SUM(CAST(i.quantity * i.unit_price AS DECIMAL(19,4)))
                        FROM order_items i
                        WHERE i.organization_id = :organizationId
                          AND i.order_id = o.id
                          AND i.voided_at IS NULL
                    ), 0) AS gross_total,
                    COALESCE((
                        SELECT SUM(r.amount)
                        FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.order_id = o.id
                    ), 0) AS refund_total,
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.order_id = o.id
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CASH'
                    ), 0) - COALESCE((
                        SELECT SUM(r.amount)
                        FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.order_id = o.id
                          AND r.method = 'CASH'
                    ), 0) AS cash_total,
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.order_id = o.id
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CARD'
                    ), 0) - COALESCE((
                        SELECT SUM(r.amount)
                        FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.order_id = o.id
                          AND r.method = 'CARD'
                    ), 0) AS card_total
                FROM restaurant_orders o
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                  AND o.closed_at >= :from
                  AND o.closed_at < :to
                ORDER BY o.closed_at DESC
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("from", Timestamp.from(from))
                .param("to", Timestamp.from(to))
                .query((rs, rowNum) -> {
                    BigDecimal gross = rs.getBigDecimal("gross_total");
                    BigDecimal refunded = rs.getBigDecimal("refund_total");
                    return new SaleResponse(
                            rs.getObject("id", UUID.class),
                            rs.getLong("order_number"),
                            rs.getString("table_name"),
                            rs.getString("area_name"),
                            rs.getTimestamp("closed_at").toInstant().toString(),
                            gross,
                            refunded,
                            gross.subtract(refunded),
                            rs.getBigDecimal("cash_total"),
                            rs.getBigDecimal("card_total")
                    );
                })
                .list();

        BigDecimal grossSales = sum(sales.stream().map(SaleResponse::grossTotal).toList());
        DailyTenderTotals tenderTotals = dailyTenderTotals(organizationId, locationId, from, to);
        BigDecimal refunds = tenderTotals.cashRefunds().add(tenderTotals.cardRefunds());
        BigDecimal netSales = grossSales.subtract(refunds);
        return new DailySalesResponse(
                locationId,
                location.locationName(),
                businessDate,
                location.timezone(),
                location.currency(),
                sales.size(),
                grossSales,
                refunds,
                netSales,
                tenderTotals.cashPayments().subtract(tenderTotals.cashRefunds()),
                tenderTotals.cardPayments().subtract(tenderTotals.cardRefunds()),
                sales
        );
    }

    private DailyTenderTotals dailyTenderTotals(
            UUID organizationId,
            UUID locationId,
            Instant from,
            Instant to
    ) {
        return jdbc.sql("""
                SELECT
                    COALESCE((
                        SELECT SUM(p.amount) FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.location_id = :locationId
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CASH'
                          AND p.paid_at >= :from AND p.paid_at < :to
                    ), 0) AS cash_payments,
                    COALESCE((
                        SELECT SUM(p.amount) FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.location_id = :locationId
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CARD'
                          AND p.paid_at >= :from AND p.paid_at < :to
                    ), 0) AS card_payments,
                    COALESCE((
                        SELECT SUM(r.amount) FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.location_id = :locationId
                          AND r.method = 'CASH'
                          AND r.refunded_at >= :from AND r.refunded_at < :to
                    ), 0) AS cash_refunds,
                    COALESCE((
                        SELECT SUM(r.amount) FROM payment_refunds r
                        WHERE r.organization_id = :organizationId
                          AND r.location_id = :locationId
                          AND r.method = 'CARD'
                          AND r.refunded_at >= :from AND r.refunded_at < :to
                    ), 0) AS card_refunds
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("from", Timestamp.from(from))
                .param("to", Timestamp.from(to))
                .query((rs, rowNum) -> new DailyTenderTotals(
                        rs.getBigDecimal("cash_payments"),
                        rs.getBigDecimal("card_payments"),
                        rs.getBigDecimal("cash_refunds"),
                        rs.getBigDecimal("card_refunds")
                ))
                .single();
    }

    @GetMapping("/receipt")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')")
    public ReceiptResponse receipt(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID orderId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        ReceiptOrder order = jdbc.sql("""
                SELECT
                    o.id, o.order_number, o.status, o.location_id, o.guest_count,
                    o.opened_at, o.closed_at,
                    org.name AS organization_name, org.currency,
                    l.name AS location_name, l.timezone,
                    t.name AS table_name, a.name AS area_name,
                    u.display_name AS opened_by
                FROM restaurant_orders o
                INNER JOIN organizations org ON org.id = o.organization_id
                INNER JOIN locations l ON l.id = o.location_id
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                INNER JOIN app_users u ON u.id = o.opened_by_user_id
                WHERE o.id = :orderId
                  AND o.organization_id = :organizationId
                  AND o.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                  AND o.closed_at IS NOT NULL
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new ReceiptOrder(
                        rs.getObject("id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getString("status"),
                        rs.getObject("location_id", UUID.class),
                        rs.getInt("guest_count"),
                        rs.getTimestamp("opened_at").toInstant().toString(),
                        rs.getTimestamp("closed_at").toInstant().toString(),
                        rs.getString("organization_name"),
                        rs.getString("location_name"),
                        rs.getString("timezone"),
                        rs.getString("currency"),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getString("opened_by")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND,
                        "Venta pagada no encontrada"
                ));

        List<ReceiptItem> items = listItems(organizationId, orderId);
        List<TaxSummary> taxes = taxSummary(items);
        List<ReceiptPayment> payments = listPayments(organizationId, orderId);
        List<ReceiptRefund> refunds = listRefunds(organizationId, orderId);
        BigDecimal grossTotal = sum(items.stream().map(ReceiptItem::lineTotal).toList());
        BigDecimal refundedTotal = sum(refunds.stream().map(ReceiptRefund::amount).toList());
        return new ReceiptResponse(
                "PAYMENT_RECEIPT",
                false,
                refundedTotal.signum() > 0
                        ? "Comprobante de pago corregido no fiscal"
                        : "Comprobante de pago no fiscal",
                "El IVA mostrado corresponde a la venta original. Este documento no sustituye una factura.",
                order.id(),
                order.orderNumber(),
                order.status(),
                order.organizationName(),
                order.locationId(),
                order.locationName(),
                order.timezone(),
                order.currency(),
                order.tableName(),
                order.areaName(),
                order.guestCount(),
                order.openedBy(),
                order.openedAt(),
                order.closedAt(),
                grossTotal,
                refundedTotal,
                grossTotal.subtract(refundedTotal),
                items,
                taxes,
                payments,
                refunds
        );
    }

    private List<ReceiptItem> listItems(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT product_name, sku, quantity, unit_price, tax_rate
                FROM order_items
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND voided_at IS NULL
                ORDER BY created_at, id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query((rs, rowNum) -> {
                    BigDecimal quantity = rs.getBigDecimal("quantity");
                    BigDecimal unitPrice = rs.getBigDecimal("unit_price");
                    return new ReceiptItem(
                            rs.getString("product_name"),
                            rs.getString("sku"),
                            quantity,
                            unitPrice,
                            rs.getBigDecimal("tax_rate"),
                            quantity.multiply(unitPrice)
                    );
                })
                .list();
    }

    private List<TaxSummary> taxSummary(List<ReceiptItem> items) {
        Map<BigDecimal, BigDecimal> grossByRate = new TreeMap<>();
        for (ReceiptItem item : items) {
            grossByRate.merge(item.taxRate(), item.lineTotal(), BigDecimal::add);
        }
        List<TaxSummary> result = new ArrayList<>();
        for (Map.Entry<BigDecimal, BigDecimal> entry : grossByRate.entrySet()) {
            TaxInclusivePolicy.TaxAmounts amounts = TaxInclusivePolicy.fromGross(
                    entry.getValue(),
                    entry.getKey()
            );
            result.add(new TaxSummary(
                    entry.getKey(),
                    amounts.taxableBase(),
                    amounts.taxAmount(),
                    amounts.grossAmount()
            ));
        }
        return result;
    }

    private List<ReceiptPayment> listPayments(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT p.id, p.method, p.amount, p.tendered_amount, p.change_amount,
                       p.external_reference, p.paid_at,
                       COALESCE((
                           SELECT SUM(r.amount)
                           FROM payment_refunds r
                           WHERE r.organization_id = :organizationId
                             AND r.payment_id = p.id
                       ), 0) AS refunded_amount
                FROM order_payments p
                WHERE p.organization_id = :organizationId
                  AND p.order_id = :orderId
                  AND p.status = 'COMPLETED'
                ORDER BY p.paid_at, p.id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query((rs, rowNum) -> {
                    BigDecimal amount = rs.getBigDecimal("amount");
                    BigDecimal refunded = rs.getBigDecimal("refunded_amount");
                    return new ReceiptPayment(
                            rs.getObject("id", UUID.class),
                            rs.getString("method"),
                            amount,
                            refunded,
                            amount.subtract(refunded),
                            rs.getBigDecimal("tendered_amount"),
                            rs.getBigDecimal("change_amount"),
                            rs.getString("external_reference"),
                            rs.getTimestamp("paid_at").toInstant().toString()
                    );
                })
                .list();
    }

    private List<ReceiptRefund> listRefunds(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT id, payment_id, method, amount, reason, refunded_at
                FROM payment_refunds
                WHERE organization_id = :organizationId AND order_id = :orderId
                ORDER BY refunded_at, id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query((rs, rowNum) -> new ReceiptRefund(
                        rs.getObject("id", UUID.class),
                        rs.getObject("payment_id", UUID.class),
                        rs.getString("method"),
                        rs.getBigDecimal("amount"),
                        rs.getString("reason"),
                        rs.getTimestamp("refunded_at").toInstant().toString()
                ))
                .list();
    }

    private LocationSnapshot requireLocation(UUID organizationId, UUID locationId) {
        return jdbc.sql("""
                SELECT l.name, l.timezone, o.name AS organization_name, o.currency
                FROM locations l
                INNER JOIN organizations o ON o.id = l.organization_id
                WHERE l.id = :locationId
                  AND l.organization_id = :organizationId
                  AND l.active = 1
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new LocationSnapshot(
                        rs.getString("organization_name"),
                        rs.getString("name"),
                        rs.getString("timezone"),
                        rs.getString("currency")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado"));
    }

    private BigDecimal sum(List<BigDecimal> values) {
        return values.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    private record LocationSnapshot(
            String organizationName,
            String locationName,
            String timezone,
            String currency
    ) {
    }

    private record DailyTenderTotals(
            BigDecimal cashPayments,
            BigDecimal cardPayments,
            BigDecimal cashRefunds,
            BigDecimal cardRefunds
    ) {
    }

    private record ReceiptOrder(
            UUID id,
            long orderNumber,
            String status,
            UUID locationId,
            int guestCount,
            String openedAt,
            String closedAt,
            String organizationName,
            String locationName,
            String timezone,
            String currency,
            String tableName,
            String areaName,
            String openedBy
    ) {
    }

    public record SaleResponse(
            UUID orderId,
            long orderNumber,
            String tableName,
            String areaName,
            String closedAt,
            BigDecimal grossTotal,
            BigDecimal refundedTotal,
            BigDecimal total,
            BigDecimal cashTotal,
            BigDecimal cardTotal
    ) {
    }

    public record DailySalesResponse(
            UUID locationId,
            String locationName,
            LocalDate businessDate,
            String timezone,
            String currency,
            int orderCount,
            BigDecimal grossSales,
            BigDecimal refunds,
            BigDecimal netSales,
            BigDecimal cashSales,
            BigDecimal cardSales,
            List<SaleResponse> sales
    ) {
    }

    public record ReceiptItem(
            String productName,
            String sku,
            BigDecimal quantity,
            BigDecimal unitPrice,
            BigDecimal taxRate,
            BigDecimal lineTotal
    ) {
    }

    public record TaxSummary(
            BigDecimal taxRate,
            BigDecimal taxableBase,
            BigDecimal taxAmount,
            BigDecimal grossAmount
    ) {
    }

    public record ReceiptPayment(
            UUID id,
            String method,
            BigDecimal amount,
            BigDecimal refundedAmount,
            BigDecimal refundableAmount,
            BigDecimal tenderedAmount,
            BigDecimal changeAmount,
            String externalReference,
            String paidAt
    ) {
    }

    public record ReceiptRefund(
            UUID id,
            UUID paymentId,
            String method,
            BigDecimal amount,
            String reason,
            String refundedAt
    ) {
    }

    public record ReceiptResponse(
            String documentType,
            boolean fiscalDocument,
            String title,
            String disclaimer,
            UUID orderId,
            long orderNumber,
            String status,
            String organizationName,
            UUID locationId,
            String locationName,
            String timezone,
            String currency,
            String tableName,
            String areaName,
            int guestCount,
            String openedBy,
            String openedAt,
            String closedAt,
            BigDecimal grossTotal,
            BigDecimal refundedTotal,
            BigDecimal total,
            List<ReceiptItem> items,
            List<TaxSummary> taxes,
            List<ReceiptPayment> payments,
            List<ReceiptRefund> refunds
    ) {
    }
}
