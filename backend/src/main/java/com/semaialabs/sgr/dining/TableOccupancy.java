package com.semaialabs.sgr.dining;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

@Component
public class TableOccupancy {
    private final JdbcClient jdbc;

    public TableOccupancy(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    public void reconcileLocation(UUID organizationId, UUID locationId) {
        sweepAbandonedOrders(organizationId, locationId);
        jdbc.sql("""
                UPDATE t
                SET status = s.live_status,
                    version = t.version + 1,
                    updated_at = SYSUTCDATETIME()
                FROM dining_tables t
                CROSS APPLY (
                    SELECT CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM restaurant_orders o
                            WHERE o.table_id = t.id
                              AND o.organization_id = t.organization_id
                              AND o.closed_at IS NULL
                              AND o.status = 'WAITING_PAYMENT'
                        ) THEN 'WAITING_PAYMENT'
                        WHEN EXISTS (
                            SELECT 1
                            FROM restaurant_orders o
                            WHERE o.table_id = t.id
                              AND o.organization_id = t.organization_id
                              AND o.closed_at IS NULL
                              AND o.status = 'OPEN'
                              AND EXISTS (
                                  SELECT 1
                                  FROM order_items i
                                  WHERE i.order_id = o.id
                                    AND i.organization_id = o.organization_id
                                    AND i.voided_at IS NULL
                              )
                        ) THEN 'OCCUPIED'
                        WHEN t.status IN ('OUT_OF_SERVICE', 'RESERVED') THEN t.status
                        ELSE 'FREE'
                    END AS live_status
                ) s
                WHERE t.organization_id = :organizationId
                  AND t.location_id = :locationId
                  AND t.active = 1
                  AND t.status <> s.live_status
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .update();
    }

    private void sweepAbandonedOrders(UUID organizationId, UUID locationId) {
        jdbc.sql("""
                UPDATE o
                SET status = 'CANCELLED',
                    closed_at = SYSUTCDATETIME(),
                    version = o.version + 1,
                    updated_at = SYSUTCDATETIME()
                FROM restaurant_orders o
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.closed_at IS NULL
                  AND o.status = 'OPEN'
                  AND NOT EXISTS (
                      SELECT 1
                      FROM order_payments p
                      WHERE p.order_id = o.id
                        AND p.organization_id = o.organization_id
                        AND p.status = 'COMPLETED'
                  )
                  AND (
                      NOT EXISTS (
                          SELECT 1
                          FROM order_items i
                          WHERE i.order_id = o.id
                            AND i.organization_id = o.organization_id
                            AND i.voided_at IS NULL
                      )
                      OR o.opened_at < DATEADD(HOUR, -36, SYSUTCDATETIME())
                  )
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .update();
        jdbc.sql("""
                UPDATE r
                SET status = 'CANCELLED',
                    completed_at = SYSUTCDATETIME(),
                    version = r.version + 1
                FROM kitchen_rounds r
                INNER JOIN restaurant_orders o ON o.id = r.order_id AND o.organization_id = r.organization_id
                WHERE r.organization_id = :organizationId
                  AND r.location_id = :locationId
                  AND r.status IN ('QUEUED', 'PREPARING', 'READY')
                  AND o.status = 'CANCELLED'
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .update();
    }

    public void syncTable(UUID organizationId, UUID tableId) {
        jdbc.sql("""
                UPDATE t
                SET status = s.live_status,
                    version = t.version + 1,
                    updated_at = SYSUTCDATETIME()
                FROM dining_tables t
                CROSS APPLY (
                    SELECT CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM restaurant_orders o
                            WHERE o.table_id = t.id
                              AND o.organization_id = t.organization_id
                              AND o.closed_at IS NULL
                              AND o.status = 'WAITING_PAYMENT'
                        ) THEN 'WAITING_PAYMENT'
                        WHEN EXISTS (
                            SELECT 1
                            FROM restaurant_orders o
                            WHERE o.table_id = t.id
                              AND o.organization_id = t.organization_id
                              AND o.closed_at IS NULL
                              AND o.status = 'OPEN'
                              AND EXISTS (
                                  SELECT 1
                                  FROM order_items i
                                  WHERE i.order_id = o.id
                                    AND i.organization_id = o.organization_id
                                    AND i.voided_at IS NULL
                              )
                        ) THEN 'OCCUPIED'
                        WHEN t.status IN ('OUT_OF_SERVICE', 'RESERVED') THEN t.status
                        ELSE 'FREE'
                    END AS live_status
                ) s
                WHERE t.organization_id = :organizationId
                  AND t.id = :tableId
                  AND t.active = 1
                  AND t.status <> s.live_status
                """)
                .param("organizationId", organizationId)
                .param("tableId", tableId)
                .update();
    }

    public int countActivePedidos(UUID organizationId, UUID tableId) {
        return jdbc.sql("""
                SELECT COUNT(*)
                FROM restaurant_orders o
                WHERE o.table_id = :tableId
                  AND o.organization_id = :organizationId
                  AND o.closed_at IS NULL
                  AND (
                      o.status = 'WAITING_PAYMENT'
                      OR (
                          o.status = 'OPEN'
                          AND EXISTS (
                              SELECT 1
                              FROM order_items i
                              WHERE i.order_id = o.id
                                AND i.organization_id = o.organization_id
                                AND i.voided_at IS NULL
                          )
                      )
                  )
                """)
                .param("tableId", tableId)
                .param("organizationId", organizationId)
                .query(Integer.class)
                .single();
    }
}
