package com.semaialabs.sgr.report;

import com.semaialabs.sgr.tenant.TenantContext;
import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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
@RequestMapping("/api/reports")
public class ReportController {
    private final JdbcClient jdbc;

    public ReportController(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/dashboard")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    public DashboardResponse dashboard(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to
    ) {
        if (to.isBefore(from)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El rango de fechas no es válido");
        }
        if (ChronoUnit.DAYS.between(from, to) > 366) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El rango máximo es de 366 días");
        }

        UUID organizationId = TenantContext.organizationId(jwt);
        LocationSnapshot location = requireLocation(organizationId, locationId);
        ZoneId zone = ZoneId.of(location.timezone());
        Instant fromInstant = from.atStartOfDay(zone).toInstant();
        Instant toInstant = to.plusDays(1).atStartOfDay(zone).toInstant();

        Map<LocalDate, MutableDailySales> days = new LinkedHashMap<>();
        for (LocalDate day = from; !day.isAfter(to); day = day.plusDays(1)) {
            days.put(day, new MutableDailySales());
        }

        jdbc.sql("""
                SELECT o.closed_at,
                       COALESCE(SUM(CAST(i.quantity * i.unit_price AS DECIMAL(19,4))), 0) AS gross_sales
                FROM restaurant_orders o
                INNER JOIN order_items i
                    ON i.order_id = o.id
                   AND i.organization_id = o.organization_id
                   AND i.voided_at IS NULL
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                  AND o.closed_at >= :fromInstant
                  AND o.closed_at < :toInstant
                GROUP BY o.id, o.closed_at
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("fromInstant", Timestamp.from(fromInstant))
                .param("toInstant", Timestamp.from(toInstant))
                .query((rs, rowNum) -> new SaleRow(
                        rs.getTimestamp("closed_at").toInstant(),
                        rs.getBigDecimal("gross_sales")
                ))
                .list()
                .forEach(row -> {
                    MutableDailySales day = days.get(row.closedAt().atZone(zone).toLocalDate());
                    if (day != null) {
                        day.grossSales = day.grossSales.add(row.grossSales());
                        day.orderCount++;
                    }
                });

        jdbc.sql("""
                SELECT refunded_at, amount
                FROM payment_refunds
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND refunded_at >= :fromInstant
                  AND refunded_at < :toInstant
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("fromInstant", Timestamp.from(fromInstant))
                .param("toInstant", Timestamp.from(toInstant))
                .query((rs, rowNum) -> new RefundRow(
                        rs.getTimestamp("refunded_at").toInstant(),
                        rs.getBigDecimal("amount")
                ))
                .list()
                .forEach(row -> {
                    MutableDailySales day = days.get(row.refundedAt().atZone(zone).toLocalDate());
                    if (day != null) {
                        day.refunds = day.refunds.add(row.amount());
                    }
                });

        List<DailySalesPoint> dailySales = days.entrySet().stream()
                .map(entry -> new DailySalesPoint(
                        entry.getKey(),
                        entry.getValue().orderCount,
                        entry.getValue().grossSales,
                        entry.getValue().refunds,
                        entry.getValue().grossSales.subtract(entry.getValue().refunds)
                ))
                .toList();

        List<CategoryPoint> categories = jdbc.sql("""
                SELECT c.id, c.name, c.sort_order, COUNT(p.id) AS active_products
                FROM menu_categories c
                LEFT JOIN products p
                    ON p.category_id = c.id
                   AND p.organization_id = c.organization_id
                   AND p.location_id = c.location_id
                   AND p.active = 1
                WHERE c.organization_id = :organizationId
                  AND c.location_id = :locationId
                  AND c.active = 1
                GROUP BY c.id, c.name, c.sort_order
                ORDER BY active_products DESC, c.sort_order, c.name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new CategoryPoint(
                        rs.getObject("id", UUID.class),
                        rs.getString("name"),
                        rs.getInt("active_products")
                ))
                .list();

        List<BestSellingProductPoint> bestSellingProducts = jdbc.sql("""
                SELECT TOP (8)
                       i.product_id,
                       MAX(i.product_name) AS product_name,
                       MAX(i.sku) AS sku,
                       SUM(i.quantity) AS quantity_sold,
                       SUM(i.quantity * i.unit_price) AS gross_sales
                FROM restaurant_orders o
                INNER JOIN order_items i
                    ON i.order_id = o.id
                   AND i.organization_id = o.organization_id
                   AND i.voided_at IS NULL
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.status IN ('PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
                  AND o.closed_at >= :fromInstant
                  AND o.closed_at < :toInstant
                GROUP BY i.product_id
                ORDER BY SUM(i.quantity) DESC,
                         SUM(i.quantity * i.unit_price) DESC,
                         MAX(i.product_name)
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("fromInstant", Timestamp.from(fromInstant))
                .param("toInstant", Timestamp.from(toInstant))
                .query((rs, rowNum) -> new BestSellingProductPoint(
                        rs.getObject("product_id", UUID.class),
                        rs.getString("product_name"),
                        rs.getString("sku"),
                        rs.getBigDecimal("quantity_sold"),
                        rs.getBigDecimal("gross_sales")
                ))
                .list();

        Map<String, MutablePaymentMethod> methods = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT method, COUNT(*) AS payment_count, SUM(amount) AS gross_amount
                FROM order_payments
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND status = 'COMPLETED'
                  AND paid_at >= :fromInstant
                  AND paid_at < :toInstant
                GROUP BY method
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("fromInstant", Timestamp.from(fromInstant))
                .param("toInstant", Timestamp.from(toInstant))
                .query((rs, rowNum) -> new PaymentRow(
                        rs.getString("method"),
                        rs.getInt("payment_count"),
                        rs.getBigDecimal("gross_amount")
                ))
                .list()
                .forEach(row -> methods.put(
                        row.method(),
                        new MutablePaymentMethod(row.count(), row.grossAmount())
                ));
        jdbc.sql("""
                SELECT method, SUM(amount) AS refund_amount
                FROM payment_refunds
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND refunded_at >= :fromInstant
                  AND refunded_at < :toInstant
                GROUP BY method
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("fromInstant", Timestamp.from(fromInstant))
                .param("toInstant", Timestamp.from(toInstant))
                .query((rs, rowNum) -> new PaymentRefundRow(
                        rs.getString("method"),
                        rs.getBigDecimal("refund_amount")
                ))
                .list()
                .forEach(row -> methods
                        .computeIfAbsent(row.method(), ignored -> new MutablePaymentMethod(0, BigDecimal.ZERO))
                        .refunds = row.refunds());

        List<PaymentMethodPoint> paymentMethods = new ArrayList<>();
        for (String method : List.of("CASH", "CARD")) {
            MutablePaymentMethod amounts = methods.get(method);
            if (amounts != null) {
                paymentMethods.add(new PaymentMethodPoint(
                        method,
                        amounts.count,
                        amounts.gross,
                        amounts.refunds,
                        amounts.gross.subtract(amounts.refunds)
                ));
            }
        }

        BigDecimal grossSales = dailySales.stream()
                .map(DailySalesPoint::grossSales)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal refunds = dailySales.stream()
                .map(DailySalesPoint::refunds)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        int orderCount = dailySales.stream().mapToInt(DailySalesPoint::orderCount).sum();
        int activeProducts = categories.stream().mapToInt(CategoryPoint::activeProducts).sum();

        return new DashboardResponse(
                locationId,
                location.name(),
                location.timezone(),
                location.currency(),
                from,
                to,
                orderCount,
                activeProducts,
                grossSales,
                refunds,
                grossSales.subtract(refunds),
                dailySales,
                categories,
                bestSellingProducts,
                paymentMethods
        );
    }

    private LocationSnapshot requireLocation(UUID organizationId, UUID locationId) {
        return jdbc.sql("""
                SELECT l.name, l.timezone, o.currency
                FROM locations l
                INNER JOIN organizations o ON o.id = l.organization_id
                WHERE l.id = :locationId
                  AND l.organization_id = :organizationId
                  AND l.active = 1
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new LocationSnapshot(
                        rs.getString("name"),
                        rs.getString("timezone"),
                        rs.getString("currency")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado"));
    }

    private static final class MutableDailySales {
        private int orderCount;
        private BigDecimal grossSales = BigDecimal.ZERO;
        private BigDecimal refunds = BigDecimal.ZERO;
    }

    private static final class MutablePaymentMethod {
        private final int count;
        private final BigDecimal gross;
        private BigDecimal refunds = BigDecimal.ZERO;

        private MutablePaymentMethod(int count, BigDecimal gross) {
            this.count = count;
            this.gross = gross;
        }
    }

    private record LocationSnapshot(String name, String timezone, String currency) { }
    private record SaleRow(Instant closedAt, BigDecimal grossSales) { }
    private record RefundRow(Instant refundedAt, BigDecimal amount) { }
    private record PaymentRow(String method, int count, BigDecimal grossAmount) { }
    private record PaymentRefundRow(String method, BigDecimal refunds) { }

    public record DailySalesPoint(
            LocalDate date,
            int orderCount,
            BigDecimal grossSales,
            BigDecimal refunds,
            BigDecimal netSales
    ) { }

    public record CategoryPoint(UUID categoryId, String name, int activeProducts) { }

    public record BestSellingProductPoint(
            UUID productId,
            String name,
            String sku,
            BigDecimal quantitySold,
            BigDecimal grossSales
    ) { }

    public record PaymentMethodPoint(
            String method,
            int paymentCount,
            BigDecimal grossAmount,
            BigDecimal refunds,
            BigDecimal netAmount
    ) { }

    public record DashboardResponse(
            UUID locationId,
            String locationName,
            String timezone,
            String currency,
            LocalDate from,
            LocalDate to,
            int orderCount,
            int activeProducts,
            BigDecimal grossSales,
            BigDecimal refunds,
            BigDecimal netSales,
            List<DailySalesPoint> dailySales,
            List<CategoryPoint> categories,
            List<BestSellingProductPoint> bestSellingProducts,
            List<PaymentMethodPoint> paymentMethods
    ) { }
}
