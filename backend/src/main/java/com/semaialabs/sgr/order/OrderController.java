package com.semaialabs.sgr.order;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.dining.TableOccupancy;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
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
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private static final String ORDER_ROLES = "hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')";

    private final JdbcClient jdbc;
    private final AuditService audit;
    private final TableOccupancy occupancy;

    public OrderController(JdbcClient jdbc, AuditService audit, TableOccupancy occupancy) {
        this.jdbc = jdbc;
        this.audit = audit;
        this.occupancy = occupancy;
    }

    @GetMapping
    public List<OrderResponse> listOpenOrders(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        occupancy.reconcileLocation(organizationId, locationId);
        List<OrderResponse> orders = jdbc.sql("""
                SELECT
                    o.id, o.order_number, o.location_id, o.table_id,
                    t.name AS table_name, a.name AS area_name,
                    o.status, o.guest_count, o.notes, o.opened_at, o.version, o.order_type
                FROM restaurant_orders o
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.closed_at IS NULL
                  AND o.status IN ('OPEN', 'WAITING_PAYMENT')
                ORDER BY o.opened_at
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> assembleOrder(
                        rs.getObject("id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("table_id", UUID.class),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getString("status"),
                        rs.getInt("guest_count"),
                        rs.getString("notes"),
                        rs.getTimestamp("opened_at").toInstant().toString(),
                        rs.getLong("version"),
                        rs.getString("order_type"),
                        List.of()
                ))
                .list();
        if (orders.isEmpty()) {
            return orders;
        }
        Map<UUID, List<OrderItemResponse>> itemsByOrder = new HashMap<>();
        jdbc.sql("""
                SELECT
                    i.order_id, i.id, i.product_id, i.product_name, i.sku, i.quantity,
                    i.unit_price, i.tax_rate, i.kitchen_note, i.sent_to_kitchen_at,
                    i.voided_at, i.void_reason, i.version,
                    COALESCE(p.prep_station, N'KITCHEN') AS prep_station
                FROM order_items i
                LEFT JOIN products p ON p.id = i.product_id
                INNER JOIN restaurant_orders o ON o.id = i.order_id
                WHERE i.organization_id = :organizationId
                  AND o.organization_id = :organizationId
                  AND o.location_id = :locationId
                  AND o.closed_at IS NULL
                  AND o.status IN ('OPEN', 'WAITING_PAYMENT')
                  AND i.voided_at IS NULL
                ORDER BY i.created_at, i.id
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> {
                    UUID orderId = rs.getObject("order_id", UUID.class);
                    itemsByOrder.computeIfAbsent(orderId, ignored -> new ArrayList<>()).add(mapItem(rs, rowNum));
                    return orderId;
                })
                .list();
        return orders.stream()
                .map(order -> assembleOrder(
                        order.id(),
                        order.orderNumber(),
                        order.locationId(),
                        order.tableId(),
                        order.tableName(),
                        order.areaName(),
                        order.status(),
                        order.guestCount(),
                        order.notes(),
                        order.openedAt(),
                        order.version(),
                        order.orderType(),
                        itemsByOrder.getOrDefault(order.id(), List.of())
                ))
                .toList();
    }

    @PostMapping
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderResponse openOrder(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody OpenOrderRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        TableSnapshot table = jdbc.sql("""
                SELECT t.name, a.name AS area_name, t.status
                FROM dining_tables t
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE t.id = :tableId
                  AND t.organization_id = :organizationId
                  AND t.location_id = :locationId
                  AND t.active = 1
                  AND a.active = 1
                """)
                .param("tableId", request.tableId())
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .query((rs, rowNum) -> new TableSnapshot(
                        rs.getString("name"),
                        rs.getString("area_name"),
                        rs.getString("status")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Mesa no encontrada"));
        if ("OUT_OF_SERVICE".equals(table.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "La mesa está fuera de servicio");
        }
        if (occupancy.countActivePedidos(organizationId, request.tableId()) > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "La mesa ya no está libre");
        }

        UUID existingEmpty = jdbc.sql("""
                SELECT TOP 1 id
                FROM restaurant_orders
                WHERE organization_id = :organizationId
                  AND table_id = :tableId
                  AND closed_at IS NULL
                  AND status = 'OPEN'
                ORDER BY opened_at
                """)
                .param("organizationId", organizationId)
                .param("tableId", request.tableId())
                .query(UUID.class)
                .optional()
                .orElse(null);
        if (existingEmpty != null) {
            return findOrder(organizationId, existingEmpty);
        }

        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO restaurant_orders (
                    id, organization_id, location_id, table_id,
                    guest_count, notes, opened_by_user_id, order_type
                ) VALUES (
                    :id, :organizationId, :locationId, :tableId,
                    :guestCount, :notes, :userId, :orderType
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("tableId", request.tableId())
                .param("guestCount", request.guestCount())
                .param("notes", clean(request.notes()))
                .param("userId", TenantContext.userId(jwt))
                .param("orderType", normalizeOrderType(request.orderType()))
                .update();

        audit.record(jwt, "ORDER_OPENED", "restaurant_order", id, Map.of("tableId", request.tableId()));
        return findOrder(organizationId, id);
    }

    @PatchMapping("/guests")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderResponse updateGuests(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateGuestsRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireOpenOrder(organizationId, request.orderId());
        Long version = jdbc.sql("""
                SELECT version
                FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pedido no encontrado"));
        if (version != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El pedido cambió en otro dispositivo; actualice la vista"
            );
        }
        jdbc.sql("""
                UPDATE restaurant_orders
                SET guest_count = :guestCount,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("guestCount", request.guestCount())
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .update();
        audit.record(
                jwt,
                "ORDER_GUESTS_UPDATED",
                "restaurant_order",
                request.orderId(),
                Map.of("guestCount", request.guestCount())
        );
        return findOrder(organizationId, request.orderId());
    }

    @PatchMapping("/channel")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderResponse updateChannel(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateChannelRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireOpenOrder(organizationId, request.orderId());
        Long version = jdbc.sql("""
                SELECT version
                FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .query(Long.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pedido no encontrado"));
        if (version != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El pedido cambió en otro dispositivo; actualice la vista"
            );
        }
        String orderType = normalizeOrderType(request.orderType());
        jdbc.sql("""
                UPDATE restaurant_orders
                SET order_type = :orderType,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderType", orderType)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .update();
        audit.record(
                jwt,
                "ORDER_CHANNEL_UPDATED",
                "restaurant_order",
                request.orderId(),
                Map.of("orderType", orderType)
        );
        return findOrder(organizationId, request.orderId());
    }

    @PostMapping("/items")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderItemResponse addItem(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody AddOrderItemRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        UUID locationId = requireOpenOrder(organizationId, request.orderId());
        ProductSnapshot product = jdbc.sql("""
                SELECT name, sku, price, tax_rate
                FROM products
                WHERE id = :productId
                  AND organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                  AND available = 1
                """)
                .param("productId", request.productId())
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new ProductSnapshot(
                        rs.getString("name"),
                        rs.getString("sku"),
                        rs.getBigDecimal("price"),
                        rs.getBigDecimal("tax_rate")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.CONFLICT,
                        "El producto no está disponible"
                ));

        AddonResolution addons = resolveAddons(
                organizationId,
                locationId,
                request.productId(),
                request.addonOptionIds()
        );
        String kitchenNote = combineNotes(addons.note(), request.kitchenNote());

        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO order_items (
                    id, organization_id, order_id, product_id,
                    product_name, sku, quantity, unit_price, tax_rate,
                    kitchen_note, created_by_user_id
                ) VALUES (
                    :id, :organizationId, :orderId, :productId,
                    :productName, :sku, :quantity, :unitPrice, :taxRate,
                    :kitchenNote, :userId
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .param("productId", request.productId())
                .param("productName", product.name())
                .param("sku", product.sku())
                .param("quantity", request.quantity())
                .param("unitPrice", product.price().add(addons.extra()))
                .param("taxRate", product.taxRate())
                .param("kitchenNote", kitchenNote)
                .param("userId", TenantContext.userId(jwt))
                .update();
        saveItemAddons(organizationId, id, addons.chosen());
        occupancy.syncTable(organizationId, tableIdForOrder(organizationId, request.orderId()));

        audit.record(jwt, "ORDER_ITEM_ADDED", "order_item", id, Map.of("orderId", request.orderId()));
        return findItem(organizationId, id);
    }

    @PatchMapping("/items")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderItemResponse editItem(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody EditOrderItemRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        OrderItemLock item = lockItem(organizationId, request.itemId());
        if (!OrderItemPolicy.canEdit(item.orderStatus(), item.sentToKitchen()) || item.voided()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La partida ya no se puede editar"
            );
        }
        if (item.version() != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La partida cambió en otro dispositivo; actualice la vista"
            );
        }
        int updated = jdbc.sql("""
                UPDATE order_items
                SET quantity = :quantity,
                    kitchen_note = :kitchenNote,
                    version = version + 1
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND sent_to_kitchen_at IS NULL
                  AND voided_at IS NULL
                """)
                .param("quantity", request.quantity())
                .param("kitchenNote", clean(request.kitchenNote()))
                .param("id", request.itemId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La partida cambió en otro dispositivo; actualice la vista"
            );
        }
        audit.record(
                jwt,
                "ORDER_ITEM_EDITED",
                "order_item",
                request.itemId(),
                Map.of("orderId", item.orderId(), "quantity", request.quantity())
        );
        return findItem(organizationId, request.itemId());
    }

    @PostMapping("/items/void")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public OrderItemResponse voidItem(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody VoidOrderItemRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        OrderItemLock item = lockItem(organizationId, request.itemId());
        if (item.voided()) {
            return findItem(organizationId, request.itemId());
        }
        if (item.version() != request.expectedVersion()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "La partida cambió en otro dispositivo; actualice la vista"
            );
        }
        if (!OrderItemPolicy.canVoid(
                item.orderStatus(),
                item.sentToKitchen(),
                jwt.getClaimAsString("role")
        )) {
            throw new ResponseStatusException(
                    item.sentToKitchen() ? HttpStatus.FORBIDDEN : HttpStatus.CONFLICT,
                    item.sentToKitchen()
                            ? "Solo un gerente puede anular una partida enviada a cocina"
                            : "La partida ya no se puede anular"
            );
        }
        jdbc.sql("""
                UPDATE order_items
                SET voided_at = SYSUTCDATETIME(),
                    void_reason = :reason,
                    voided_by_user_id = :userId,
                    version = version + 1
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND voided_at IS NULL
                """)
                .param("reason", request.reason().trim())
                .param("userId", TenantContext.userId(jwt))
                .param("id", request.itemId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        occupancy.syncTable(organizationId, tableIdForOrder(organizationId, item.orderId()));
        audit.record(
                jwt,
                item.sentToKitchen() ? "ORDER_ITEM_VOIDED_AFTER_SEND" : "ORDER_ITEM_REMOVED",
                "order_item",
                request.itemId(),
                Map.of(
                        "orderId", item.orderId(),
                        "reason", request.reason().trim(),
                        "sentToKitchen", item.sentToKitchen()
                )
        );
        return findItem(organizationId, request.itemId());
    }

    @PostMapping("/send-kitchen")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public KitchenRoundResponse sendToKitchen(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody SendKitchenRequest request
    ) {
        return sendRound(jwt, request, "KITCHEN");
    }

    @PostMapping("/send-bar")
    @PreAuthorize(ORDER_ROLES)
    @Transactional
    public KitchenRoundResponse sendToBar(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody SendKitchenRequest request
    ) {
        return sendRound(jwt, request, "BAR");
    }

    private KitchenRoundResponse sendRound(Jwt jwt, SendKitchenRequest request, String station) {
        UUID organizationId = TenantContext.organizationId(jwt);
        Optional<UUID> existing = jdbc.sql("""
                SELECT id FROM kitchen_rounds WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId AND idempotency_key = :idempotencyKey
                """)
                .param("organizationId", organizationId)
                .param("idempotencyKey", request.idempotencyKey())
                .query(UUID.class)
                .optional();
        if (existing.isPresent()) {
            return findRound(organizationId, existing.get());
        }

        UUID locationId = requireOpenOrder(organizationId, request.orderId());
        boolean bar = "BAR".equals(station);
        List<UUID> itemIds = jdbc.sql("""
                SELECT i.id
                FROM order_items i WITH (UPDLOCK, HOLDLOCK)
                INNER JOIN products p ON p.id = i.product_id
                WHERE i.organization_id = :organizationId
                  AND i.order_id = :orderId
                  AND i.voided_at IS NULL
                  AND i.sent_to_kitchen_at IS NULL
                  AND p.prep_station = :station
                ORDER BY i.created_at, i.id
                """)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .param("station", station)
                .query(UUID.class)
                .list();
        if (itemIds.isEmpty()) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    bar ? "No hay bebidas para enviar a barra" : "No hay productos de cocina para enviar"
            );
        }

        int roundNumber = jdbc.sql("""
                SELECT COALESCE(MAX(round_number), 0) + 1
                FROM kitchen_rounds WITH (UPDLOCK, HOLDLOCK)
                WHERE order_id = :orderId
                """)
                .param("orderId", request.orderId())
                .query(Integer.class)
                .single();
        UUID roundId = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO kitchen_rounds (
                    id, organization_id, location_id, order_id,
                    round_number, station, idempotency_key, sent_by_user_id
                ) VALUES (
                    :id, :organizationId, :locationId, :orderId,
                    :roundNumber, :station, :idempotencyKey, :userId
                )
                """)
                .param("id", roundId)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("orderId", request.orderId())
                .param("roundNumber", roundNumber)
                .param("station", station)
                .param("idempotencyKey", request.idempotencyKey())
                .param("userId", TenantContext.userId(jwt))
                .update();

        for (UUID itemId : itemIds) {
            jdbc.sql("""
                    INSERT INTO kitchen_round_items (round_id, order_item_id)
                    VALUES (:roundId, :itemId)
                    """)
                    .param("roundId", roundId)
                    .param("itemId", itemId)
                    .update();
            jdbc.sql("""
                    UPDATE order_items
                    SET sent_to_kitchen_at = SYSUTCDATETIME(), version = version + 1
                    WHERE id = :itemId AND sent_to_kitchen_at IS NULL
                    """)
                    .param("itemId", itemId)
                    .update();
        }

        audit.record(
                jwt,
                bar ? "BAR_ROUND_SENT" : "KITCHEN_ROUND_SENT",
                "kitchen_round",
                roundId,
                Map.of("orderId", request.orderId(), "itemCount", itemIds.size(), "station", station)
        );
        return findRound(organizationId, roundId);
    }

    @PostMapping("/cancel")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public OrderResponse cancelOrder(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CancelOrderRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        jdbc.sql("""
                SELECT id
                FROM order_payments WITH (UPDLOCK, HOLDLOCK)
                WHERE organization_id = :organizationId AND order_id = :orderId
                """)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .query(UUID.class)
                .list();
        CancelOrderLock order = jdbc.sql("""
                SELECT table_id, status
                FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new CancelOrderLock(
                        rs.getObject("table_id", UUID.class),
                        rs.getString("status")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pedido no encontrado"));
        if ("CANCELLED".equals(order.status())) {
            return findOrder(organizationId, request.orderId());
        }
        if (!"OPEN".equals(order.status()) && !"WAITING_PAYMENT".equals(order.status())) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Solo se pueden anular pedidos que todavía no estén cerrados"
            );
        }
        BigDecimal netPaid = jdbc.sql("""
                SELECT
                    COALESCE((
                        SELECT SUM(amount) FROM order_payments
                        WHERE organization_id = :organizationId
                          AND order_id = :orderId
                          AND status = 'COMPLETED'
                    ), 0)
                    -
                    COALESCE((
                        SELECT SUM(amount) FROM payment_refunds
                        WHERE organization_id = :organizationId
                          AND order_id = :orderId
                    ), 0)
                """)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .query(BigDecimal.class)
                .single();
        if (netPaid.signum() != 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "Reembolse el saldo cobrado antes de anular el pedido"
            );
        }

        jdbc.sql("""
                UPDATE restaurant_orders
                SET status = 'CANCELLED',
                    closed_at = SYSUTCDATETIME(),
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", request.orderId())
                .param("organizationId", organizationId)
                .update();
        jdbc.sql("""
                UPDATE kitchen_rounds
                SET status = 'CANCELLED',
                    completed_at = SYSUTCDATETIME(),
                    version = version + 1
                WHERE organization_id = :organizationId
                  AND order_id = :orderId
                  AND status IN ('QUEUED', 'PREPARING', 'READY')
                """)
                .param("organizationId", organizationId)
                .param("orderId", request.orderId())
                .update();
        jdbc.sql("""
                UPDATE dining_tables
                SET status = 'FREE',
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :tableId
                  AND organization_id = :organizationId
                  AND status IN ('OCCUPIED', 'WAITING_PAYMENT')
                """)
                .param("tableId", order.tableId())
                .param("organizationId", organizationId)
                .update();
        audit.record(
                jwt,
                "ORDER_CANCELLED",
                "restaurant_order",
                request.orderId(),
                Map.of("reason", request.reason().trim())
        );
        return findOrder(organizationId, request.orderId());
    }

    private OrderItemLock lockItem(UUID organizationId, UUID itemId) {
        return jdbc.sql("""
                SELECT i.order_id, i.sent_to_kitchen_at, i.voided_at, i.version,
                       o.status AS order_status
                FROM order_items i WITH (UPDLOCK, HOLDLOCK)
                INNER JOIN restaurant_orders o WITH (UPDLOCK, HOLDLOCK)
                    ON o.id = i.order_id AND o.organization_id = i.organization_id
                WHERE i.id = :itemId AND i.organization_id = :organizationId
                """)
                .param("itemId", itemId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new OrderItemLock(
                        rs.getObject("order_id", UUID.class),
                        rs.getString("order_status"),
                        rs.getTimestamp("sent_to_kitchen_at") != null,
                        rs.getTimestamp("voided_at") != null,
                        rs.getLong("version")
                ))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Partida no encontrada"));
    }

    private UUID tableIdForOrder(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT table_id
                FROM restaurant_orders
                WHERE id = :orderId AND organization_id = :organizationId
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query(UUID.class)
                .single();
    }

    private UUID requireOpenOrder(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT location_id FROM restaurant_orders WITH (UPDLOCK, HOLDLOCK)
                WHERE id = :orderId
                  AND organization_id = :organizationId
                  AND status = 'OPEN'
                  AND closed_at IS NULL
                """)
                .param("orderId", orderId)
                .param("organizationId", organizationId)
                .query(UUID.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.CONFLICT, "El pedido no está abierto"));
    }

    private OrderResponse findOrder(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT
                    o.id, o.order_number, o.location_id, o.table_id,
                    t.name AS table_name, a.name AS area_name,
                    o.status, o.guest_count, o.notes, o.opened_at, o.version, o.order_type
                FROM restaurant_orders o
                INNER JOIN dining_tables t ON t.id = o.table_id
                INNER JOIN dining_areas a ON a.id = t.area_id
                WHERE o.id = :id AND o.organization_id = :organizationId
                """)
                .param("id", orderId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> toOrderResponse(
                        organizationId,
                        rs.getObject("id", UUID.class),
                        rs.getLong("order_number"),
                        rs.getObject("location_id", UUID.class),
                        rs.getObject("table_id", UUID.class),
                        rs.getString("table_name"),
                        rs.getString("area_name"),
                        rs.getString("status"),
                        rs.getInt("guest_count"),
                        rs.getString("notes"),
                        rs.getTimestamp("opened_at").toInstant().toString(),
                        rs.getLong("version"),
                        rs.getString("order_type")
                ))
                .single();
    }

    private OrderResponse toOrderResponse(
            UUID organizationId,
            UUID id,
            long orderNumber,
            UUID locationId,
            UUID tableId,
            String tableName,
            String areaName,
            String status,
            int guestCount,
            String notes,
            String openedAt,
            long version,
            String orderType
    ) {
        return assembleOrder(
                id, orderNumber, locationId, tableId, tableName, areaName,
                status, guestCount, notes, openedAt, version, orderType, listItems(organizationId, id)
        );
    }

    private OrderResponse assembleOrder(
            UUID id,
            long orderNumber,
            UUID locationId,
            UUID tableId,
            String tableName,
            String areaName,
            String status,
            int guestCount,
            String notes,
            String openedAt,
            long version,
            String orderType,
            List<OrderItemResponse> items
    ) {
        BigDecimal total = items.stream()
                .map(item -> item.unitPrice().multiply(item.quantity()))
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        return new OrderResponse(
                id, orderNumber, locationId, tableId, tableName, areaName,
                status, guestCount, notes, openedAt, version, total, items, orderType
        );
    }

    private String normalizeOrderType(String value) {
        if (value == null || value.isBlank() || "DINE_IN".equals(value)) {
            return "DINE_IN";
        }
        if ("TAKEAWAY".equals(value) || "DELIVERY".equals(value)) {
            return value;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Tipo de pedido no válido");
    }

    private List<OrderItemResponse> listItems(UUID organizationId, UUID orderId) {
        return jdbc.sql("""
                SELECT
                    i.id, i.product_id, i.product_name, i.sku, i.quantity,
                    i.unit_price, i.tax_rate, i.kitchen_note, i.sent_to_kitchen_at,
                    i.voided_at, i.void_reason, i.version,
                    COALESCE(p.prep_station, N'KITCHEN') AS prep_station
                FROM order_items i
                LEFT JOIN products p ON p.id = i.product_id
                WHERE i.organization_id = :organizationId
                  AND i.order_id = :orderId
                  AND i.voided_at IS NULL
                ORDER BY i.created_at, i.id
                """)
                .param("organizationId", organizationId)
                .param("orderId", orderId)
                .query(this::mapItem)
                .list();
    }

    private OrderItemResponse mapItem(ResultSet rs, int rowNum) throws SQLException {
        String station = rs.getString("prep_station");
        return new OrderItemResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("product_id", UUID.class),
                rs.getString("product_name"),
                rs.getString("sku"),
                rs.getBigDecimal("quantity"),
                rs.getBigDecimal("unit_price"),
                rs.getBigDecimal("tax_rate"),
                rs.getString("kitchen_note"),
                rs.getTimestamp("sent_to_kitchen_at") != null,
                rs.getTimestamp("voided_at") != null,
                rs.getString("void_reason"),
                station == null || station.isBlank() ? "KITCHEN" : station,
                rs.getLong("version")
        );
    }

    private OrderItemResponse findItem(UUID organizationId, UUID itemId) {
        return jdbc.sql("""
                SELECT
                    i.id, i.product_id, i.product_name, i.sku, i.quantity,
                    i.unit_price, i.tax_rate, i.kitchen_note, i.sent_to_kitchen_at,
                    i.voided_at, i.void_reason, i.version,
                    COALESCE(p.prep_station, N'KITCHEN') AS prep_station
                FROM order_items i
                LEFT JOIN products p ON p.id = i.product_id
                WHERE i.id = :id AND i.organization_id = :organizationId
                """)
                .param("id", itemId)
                .param("organizationId", organizationId)
                .query(this::mapItem)
                .single();
    }

    private KitchenRoundResponse findRound(UUID organizationId, UUID roundId) {
        return jdbc.sql("""
                SELECT
                    r.id, r.order_id, r.round_number, r.status, r.sent_at,
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
                        listRoundItems(organizationId, roundId),
                        0
                ))
                .single();
    }

    private List<OrderItemResponse> listRoundItems(UUID organizationId, UUID roundId) {
        return jdbc.sql("""
                SELECT
                    i.id, i.product_id, i.product_name, i.sku, i.quantity,
                    i.unit_price, i.tax_rate, i.kitchen_note, i.sent_to_kitchen_at,
                    i.voided_at, i.void_reason, i.version,
                    COALESCE(p.prep_station, N'KITCHEN') AS prep_station
                FROM kitchen_round_items ri
                INNER JOIN order_items i ON i.id = ri.order_item_id
                LEFT JOIN products p ON p.id = i.product_id
                WHERE ri.round_id = :roundId AND i.organization_id = :organizationId
                ORDER BY i.created_at, i.id
                """)
                .param("roundId", roundId)
                .param("organizationId", organizationId)
                .query(this::mapItem)
                .list();
    }

    private AddonResolution resolveAddons(
            UUID organizationId,
            UUID locationId,
            UUID productId,
            List<UUID> optionIds
    ) {
        List<AddonGroupRow> groups = jdbc.sql("""
                SELECT g.id, g.name, g.required, g.min_select, g.max_select
                FROM addon_groups g
                INNER JOIN product_addon_groups pg ON pg.group_id = g.id
                WHERE g.organization_id = :organizationId
                  AND g.location_id = :locationId
                  AND g.active = 1
                  AND pg.product_id = :productId
                ORDER BY g.sort_order, g.name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .param("productId", productId)
                .query((rs, rowNum) -> new AddonGroupRow(
                        rs.getObject("id", UUID.class),
                        rs.getString("name"),
                        rs.getBoolean("required"),
                        rs.getInt("min_select"),
                        rs.getInt("max_select")
                ))
                .list();
        List<UUID> requested = new ArrayList<>();
        for (UUID optionId : Objects.requireNonNullElse(optionIds, List.<UUID>of())) {
            if (!requested.contains(optionId)) {
                requested.add(optionId);
            }
        }
        if (groups.isEmpty()) {
            if (!requested.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Este producto no admite adicionales");
            }
            return AddonResolution.none();
        }
        List<UUID> groupIds = groups.stream().map(AddonGroupRow::id).toList();
        Map<UUID, AddonOptionRow> options = new LinkedHashMap<>();
        jdbc.sql("""
                SELECT id, group_id, name, price
                FROM addon_options
                WHERE organization_id = :organizationId
                  AND group_id IN (:groupIds)
                  AND active = 1
                  AND available = 1
                """)
                .param("organizationId", organizationId)
                .param("groupIds", groupIds)
                .query((rs, rowNum) -> {
                    AddonOptionRow option = new AddonOptionRow(
                            rs.getObject("id", UUID.class),
                            rs.getObject("group_id", UUID.class),
                            rs.getString("name"),
                            rs.getBigDecimal("price")
                    );
                    options.put(option.id(), option);
                    return option.id();
                })
                .list();
        Map<UUID, List<AddonOptionRow>> chosenByGroup = new HashMap<>();
        List<ChosenAddon> chosen = new ArrayList<>();
        BigDecimal extra = BigDecimal.ZERO;
        for (UUID optionId : requested) {
            AddonOptionRow option = options.get(optionId);
            if (option == null) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Hay adicionales no disponibles");
            }
            AddonGroupRow group = groups.stream()
                    .filter(item -> item.id().equals(option.groupId()))
                    .findFirst()
                    .orElseThrow(() -> new ResponseStatusException(
                            HttpStatus.BAD_REQUEST,
                            "Hay adicionales que no corresponden al producto"
                    ));
            chosenByGroup.computeIfAbsent(group.id(), ignored -> new ArrayList<>()).add(option);
            chosen.add(new ChosenAddon(group.id(), option.id(), group.name(), option.name(), option.price()));
            extra = extra.add(option.price());
        }
        List<String> noteParts = new ArrayList<>();
        for (AddonGroupRow group : groups) {
            List<AddonOptionRow> selected = chosenByGroup.getOrDefault(group.id(), List.of());
            int min = group.required() ? Math.max(1, group.minSelect()) : Math.max(0, group.minSelect());
            if (selected.size() < min) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Faltan opciones en " + group.name()
                );
            }
            if (selected.size() > group.maxSelect()) {
                throw new ResponseStatusException(
                        HttpStatus.BAD_REQUEST,
                        "Demasiadas opciones en " + group.name()
                );
            }
            if (!selected.isEmpty()) {
                noteParts.add(group.name() + ": " + String.join(
                        ", ",
                        selected.stream().map(AddonOptionRow::name).toList()
                ));
            }
        }
        return new AddonResolution(extra, String.join(" · ", noteParts), chosen);
    }

    private void saveItemAddons(UUID organizationId, UUID itemId, List<ChosenAddon> chosen) {
        for (ChosenAddon addon : chosen) {
            jdbc.sql("""
                    INSERT INTO order_item_addons (
                        id, organization_id, order_item_id, group_id, option_id,
                        group_name, option_name, price
                    ) VALUES (
                        :id, :organizationId, :itemId, :groupId, :optionId,
                        :groupName, :optionName, :price
                    )
                    """)
                    .param("id", UUID.randomUUID())
                    .param("organizationId", organizationId)
                    .param("itemId", itemId)
                    .param("groupId", addon.groupId())
                    .param("optionId", addon.optionId())
                    .param("groupName", addon.groupName())
                    .param("optionName", addon.optionName())
                    .param("price", addon.price())
                    .update();
        }
    }

    private String combineNotes(String addonNote, String kitchenNote) {
        String extras = clean(addonNote);
        String note = clean(kitchenNote);
        if (extras == null) {
            return note;
        }
        if (note == null) {
            return extras;
        }
        String combined = extras + "\n" + note;
        if (combined.length() > 500) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "La nota con adicionales es demasiado larga");
        }
        return combined;
    }

    private String clean(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private record TableSnapshot(String name, String areaName, String status) {
    }

    private record CancelOrderLock(UUID tableId, String status) {
    }

    private record OrderItemLock(
            UUID orderId,
            String orderStatus,
            boolean sentToKitchen,
            boolean voided,
            long version
    ) {
    }

    private record ProductSnapshot(String name, String sku, BigDecimal price, BigDecimal taxRate) {
    }

    private record AddonGroupRow(UUID id, String name, boolean required, int minSelect, int maxSelect) {
    }

    private record AddonOptionRow(UUID id, UUID groupId, String name, BigDecimal price) {
    }

    private record ChosenAddon(UUID groupId, UUID optionId, String groupName, String optionName, BigDecimal price) {
    }

    private record AddonResolution(BigDecimal extra, String note, List<ChosenAddon> chosen) {
        static AddonResolution none() {
            return new AddonResolution(BigDecimal.ZERO, "", List.of());
        }
    }

    public record OpenOrderRequest(
            @NotNull UUID locationId,
            @NotNull UUID tableId,
            @Min(1) @Max(999) int guestCount,
            @Size(max = 500) String notes,
            @Size(max = 24) String orderType
    ) {
    }

    public record UpdateGuestsRequest(
            @NotNull UUID orderId,
            @Min(1) @Max(999) int guestCount,
            @Min(0) long expectedVersion
    ) {
    }

    public record UpdateChannelRequest(
            @NotNull UUID orderId,
            @NotBlank @Size(max = 24) String orderType,
            @Min(0) long expectedVersion
    ) {
    }

    public record AddOrderItemRequest(
            @NotNull UUID orderId,
            @NotNull UUID productId,
            @NotNull @DecimalMin("0.001") @Digits(integer = 7, fraction = 3) BigDecimal quantity,
            @Size(max = 500) String kitchenNote,
            List<UUID> addonOptionIds
    ) {
    }

    public record EditOrderItemRequest(
            @NotNull UUID itemId,
            @NotNull @DecimalMin("0.001") @Digits(integer = 7, fraction = 3) BigDecimal quantity,
            @Size(max = 500) String kitchenNote,
            @Min(0) long expectedVersion
    ) {
    }

    public record VoidOrderItemRequest(
            @NotNull UUID itemId,
            @NotBlank @Size(max = 500) String reason,
            @Min(0) long expectedVersion
    ) {
    }

    public record SendKitchenRequest(
            @NotNull UUID orderId,
            @NotNull UUID idempotencyKey
    ) {
    }

    public record CancelOrderRequest(
            @NotNull UUID orderId,
            @NotBlank @Size(max = 500) String reason
    ) {
    }

    public record OrderItemResponse(
            UUID id,
            UUID productId,
            String productName,
            String sku,
            BigDecimal quantity,
            BigDecimal unitPrice,
            BigDecimal taxRate,
            String kitchenNote,
            boolean sentToKitchen,
            boolean voided,
            String voidReason,
            String prepStation,
            long version
    ) {
    }

    public record OrderResponse(
            UUID id,
            long orderNumber,
            UUID locationId,
            UUID tableId,
            String tableName,
            String areaName,
            String status,
            int guestCount,
            String notes,
            String openedAt,
            long version,
            BigDecimal total,
            List<OrderItemResponse> items,
            String orderType
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
            List<OrderItemResponse> items,
            long version
    ) {
    }
}
