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
                    ), 0) AS total,
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.order_id = o.id
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CASH'
                    ), 0) AS cash_total,
                    COALESCE((
                        SELECT SUM(p.amount)
                        FROM order_payments p
                        WHERE p.organization_id = :organizationId
                          AND p.order_id = o.id
                          AND p.status = 'COMPLETED'
                          AND p.method = 'CARD'
                    ), 0) AS card_total
                FROM restaurant_orders o
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.status = 'PAID'
                  AND o.closed_at >= :from
                  AND o.closed_at < :to
                ORDER BY o.closed_at DESC
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("from", Timestamp.from(from))
                .param("to", Timestamp.from(to))
                .query((rs, rowNum) -> new SaleResponse(
                        rs.getObject("id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getTimestamp("closed_at").toInstant().toString(),
                        rs.getBigDecimal("total"),
                        rs.getBigDecimal("cash_total"),
                        rs.getBigDecimal("card_total")
                ))
                .list();

        BigDecimal grossSales = sum(sales.stream().map(SaleResponse::total).toList());
        BigDecimal cashSales = sum(sales.stream().map(SaleResponse::cashTotal).toList());
        BigDecimal cardSales = sum(sales.stream().map(SaleResponse::cardTotal).toList());
        return new DailySalesResponse(
                locationId,
                location.locationName(),
                businessDate,
                location.timezone(),
                location.currency(),
                sales.size(),
                grossSales,
                cashSales,
                cardSales,
                sales
        );
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
                    o.id, o.order_number, o.location_id, o.guest_count,
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
                  AND o.status = 'PAID'
                  AND o.closed_at IS NOT NULL
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new ReceiptOrder(
                        rs.getObject("id", UUID.class),
                        rs.getLong("order_number"),
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
        BigDecimal total = sum(items.stream().map(ReceiptItem::lineTotal).toList());
        return new ReceiptResponse(
                "PAYMENT_RECEIPT",
                false,
                "Comprobante de pago no fiscal",
                "Los precios mostrados incluyen IVA. Este documento no sustituye una factura.",
                order.id(),
                order.orderNumber(),
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
                total,
                items,
                taxes,
                payments
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
                SELECT method, amount, tendered_amount, change_amount,
                       external_reference, paid_at
                FROM order_payments
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND status = 'COMPLETED'
                ORDER BY paid_at, id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query((rs, rowNum) -> new ReceiptPayment(
                        rs.getString("method"),
                        rs.getBigDecimal("amount"),
                        rs.getBigDecimal("tendered_amount"),
                        rs.getBigDecimal("change_amount"),
                        rs.getString("external_reference"),
                        rs.getTimestamp("paid_at").toInstant().toString()
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

    private record ReceiptOrder(
            UUID id,
            long orderNumber,
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
            String method,
            BigDecimal amount,
            BigDecimal tenderedAmount,
            BigDecimal changeAmount,
            String externalReference,
            String paidAt
    ) {
    }

    public record ReceiptResponse(
            String documentType,
            boolean fiscalDocument,
            String title,
            String disclaimer,
            UUID orderId,
            long orderNumber,
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
            BigDecimal total,
            List<ReceiptItem> items,
            List<TaxSummary> taxes,
            List<ReceiptPayment> payments
    ) {
    }
}
