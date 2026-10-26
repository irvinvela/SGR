package com.semaialabs.sgr.migration;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.temporal.ChronoField;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
@ConditionalOnProperty(name = "sgr.import.flo.path")
public class FloImportRunner implements ApplicationRunner {
    private static final Logger log = LoggerFactory.getLogger(FloImportRunner.class);
    private static final String SOURCE_SYSTEM = "FLO_POS";
    private static final String EXPECTED_BUSINESS = "Obelisco";
    private static final String EXPECTED_STORE_ID = "1305";
    private static final int EXPECTED_SCHEMA = 82;
    private static final ZoneId BUSINESS_ZONE = ZoneId.of("Europe/Madrid");
    private static final DateTimeFormatter FLO_LOCAL = new DateTimeFormatterBuilder()
            .appendPattern("yyyy-MM-dd HH:mm:ss")
            .optionalStart()
            .appendFraction(ChronoField.NANO_OF_SECOND, 0, 9, true)
            .optionalEnd()
            .toFormatter(Locale.ROOT);
    private static final TypeReference<List<PaymentDetail>> PAYMENT_DETAILS =
            new TypeReference<>() { };

    private final Environment environment;
    private final ObjectMapper objectMapper;
    private final NamedParameterJdbcTemplate target;
    private final TransactionTemplate transaction;
    private final ConfigurableApplicationContext applicationContext;

    public FloImportRunner(
            Environment environment,
            ObjectMapper objectMapper,
            DataSource dataSource,
            TransactionTemplate transaction,
            ConfigurableApplicationContext applicationContext
    ) {
        this.environment = environment;
        this.objectMapper = objectMapper;
        this.target = new NamedParameterJdbcTemplate(dataSource);
        this.transaction = transaction;
        this.applicationContext = applicationContext;
    }

    @Override
    public void run(ApplicationArguments args) throws Exception {
        String sourcePath = requiredProperty("sgr.import.flo.path");
        String mode = environment.getProperty("sgr.import.flo.mode", "dry-run").trim().toLowerCase(Locale.ROOT);
        if (!Set.of("dry-run", "apply", "verify").contains(mode)) {
            throw new IllegalArgumentException("sgr.import.flo.mode debe ser dry-run, apply o verify");
        }

        Path source = Path.of(sourcePath).toAbsolutePath().normalize();
        if (!Files.isRegularFile(source)) {
            throw new IllegalArgumentException("No existe la base Flo: " + source);
        }

        String fingerprint = sha256(source);
        FloData data = readSource(source, fingerprint);
        ImportPlan plan = validateAndPlan(data);
        logPlan(plan, mode);

        try {
            if ("apply".equals(mode)) {
                transaction.executeWithoutResult(status -> importAll(plan));
                log.info("FLO_IMPORT_COMPLETED fingerprint={} organizationId={} orders={} paid={}",
                        fingerprint, plan.organizationId(), plan.data().orders().size(),
                        money(plan.data().bills().stream().map(Bill::total).reduce(BigDecimal.ZERO, BigDecimal::add)));
            } else if ("verify".equals(mode)) {
                verifyImport(plan);
            } else {
                log.info("FLO_IMPORT_DRY_RUN_OK fingerprint={}; no se escribieron datos", fingerprint);
            }
        } finally {
            SpringApplication.exit(applicationContext);
        }
    }

    private FloData readSource(Path source, String fingerprint) throws SQLException, IOException {
        try (Connection db = DriverManager.getConnection("jdbc:sqlite:" + source)) {
            try (var statement = db.createStatement()) {
                statement.execute("PRAGMA query_only = ON");
            }
            Map<String, String> meta = keyValues(db, "_flo_meta");
            Map<String, String> settings = keyValues(db, "settings");
            int userVersion = scalarInt(db, "PRAGMA user_version");

            List<FloUser> users = query(db, """
                    SELECT id, name, email, password, role, is_active, created_at, updated_at
                    FROM users ORDER BY id
                    """, rs -> new FloUser(
                    text(rs, "id"), text(rs, "name"), text(rs, "email"), text(rs, "password"),
                    text(rs, "role"), rs.getInt("is_active") == 1,
                    text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<Category> categories = query(db, """
                    SELECT id, name, sort_order, is_active, deleted_at, created_at, updated_at
                    FROM categories ORDER BY sort_order, name, id
                    """, rs -> new Category(
                    text(rs, "id"), text(rs, "name"), rs.getInt("sort_order"),
                    rs.getInt("is_active") == 1, text(rs, "deleted_at"),
                    text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<Product> products = query(db, """
                    SELECT id, category_id, name, description, price, sku, is_active,
                           sort_order, deleted_at, created_at, updated_at
                    FROM products ORDER BY name, id
                    """, rs -> new Product(
                    text(rs, "id"), text(rs, "category_id"), text(rs, "name"),
                    text(rs, "description"), decimal(rs, "price"), text(rs, "sku"),
                    rs.getInt("is_active") == 1, rs.getInt("sort_order"),
                    text(rs, "deleted_at"), text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<FloTable> tables = query(db, """
                    SELECT id, number, capacity, status, floor, section, is_active,
                           created_at, updated_at
                    FROM tables ORDER BY number, id
                    """, rs -> new FloTable(
                    text(rs, "id"), text(rs, "number"), rs.getInt("capacity"),
                    text(rs, "status"), text(rs, "floor"), text(rs, "section"),
                    rs.getInt("is_active") == 1, text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<FloOrder> orders = query(db, """
                    SELECT id, order_number, table_id, user_id, type, guest_count,
                           special_instructions, status, total, completed_at, cancelled_at,
                           cancellation_reason, created_at, updated_at
                    FROM orders ORDER BY id
                    """, rs -> new FloOrder(
                    rs.getLong("id"), text(rs, "order_number"), text(rs, "table_id"),
                    text(rs, "user_id"), text(rs, "type"), nullableInt(rs, "guest_count"),
                    text(rs, "special_instructions"), text(rs, "status"),
                    decimal(rs, "total"), text(rs, "completed_at"), text(rs, "cancelled_at"),
                    text(rs, "cancellation_reason"), text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<FloItem> items = query(db, """
                    SELECT id, order_id, product_id, product_name, product_sku, unit_price,
                           quantity, total, special_instructions, status, created_at,
                           updated_at, voided_at
                    FROM order_items ORDER BY id
                    """, rs -> new FloItem(
                    rs.getLong("id"), rs.getLong("order_id"), text(rs, "product_id"),
                    text(rs, "product_name"), text(rs, "product_sku"),
                    decimal(rs, "unit_price"), decimal(rs, "quantity"), decimal(rs, "total"),
                    text(rs, "special_instructions"), text(rs, "status"),
                    text(rs, "created_at"), text(rs, "updated_at"), text(rs, "voided_at")
            ));
            List<ItemAddon> addons = query(db, """
                    SELECT order_item_id, addon_name, price, quantity
                    FROM order_item_addons ORDER BY id
                    """, rs -> new ItemAddon(
                    rs.getLong("order_item_id"), text(rs, "addon_name"),
                    decimal(rs, "price"), rs.getInt("quantity")
            ));
            List<Bill> bills = query(db, """
                    SELECT id, bill_number, order_id, total, payment_status,
                           payment_details, paid_at, created_at, updated_at
                    FROM bills ORDER BY id
                    """, rs -> new Bill(
                    rs.getLong("id"), text(rs, "bill_number"), rs.getLong("order_id"),
                    decimal(rs, "total"), text(rs, "payment_status"),
                    parsePayments(text(rs, "payment_details")),
                    text(rs, "paid_at"), text(rs, "created_at"), text(rs, "updated_at")
            ));
            List<Refund> refunds = query(db, """
                    SELECT id, bill_id, amount_cents, method, reason, approved_by,
                           created_by, created_at, kind
                    FROM refunds ORDER BY id
                    """, rs -> new Refund(
                    rs.getLong("id"), rs.getLong("bill_id"),
                    BigDecimal.valueOf(rs.getLong("amount_cents"), 2),
                    text(rs, "method"), text(rs, "reason"), text(rs, "approved_by"),
                    text(rs, "created_by"), text(rs, "created_at"), text(rs, "kind")
            ));

            return new FloData(
                    fingerprint, userVersion, meta, settings, users, categories, products,
                    tables, orders, items, addons, bills, refunds
            );
        }
    }

    private ImportPlan validateAndPlan(FloData data) {
        String business = data.settings().get("business_name");
        String storeId = data.settings().get("cloud_store_id");
        if (data.userVersion() != EXPECTED_SCHEMA
                || !EXPECTED_BUSINESS.equals(business)
                || !EXPECTED_STORE_ID.equals(storeId)
                || !"3.7.2".equals(data.meta().get("app_version"))
                || !"2026-09-26T21:33:16.776Z".equals(data.meta().get("backup_created_at"))) {
            throw new IllegalStateException(
                    "La base no es la copia aprobada de Obelisco del 26/09/2026 (schema 82)"
            );
        }
        if (data.users().size() != 4 || data.orders().size() != 105
                || data.items().size() != 318 || data.bills().size() != 98
                || data.refunds().size() != 1) {
            throw new IllegalStateException("Los conteos de la copia Flo no coinciden con el análisis aprobado");
        }

        Map<Long, FloOrder> orders = index(data.orders(), FloOrder::id);
        Map<Long, Bill> billsByOrder = index(data.bills(), Bill::orderId);
        Set<String> productIds = data.products().stream().map(Product::id).collect(Collectors.toSet());
        if (data.items().stream().anyMatch(item -> !orders.containsKey(item.orderId())
                || !productIds.contains(item.productId()))) {
            throw new IllegalStateException("Hay partidas huérfanas en la base Flo");
        }
        for (Bill bill : data.bills()) {
            FloOrder order = orders.get(bill.orderId());
            if (order == null || !"completed".equals(order.status())) {
                throw new IllegalStateException("La cuenta Flo " + bill.id() + " no corresponde a un pedido completado");
            }
            BigDecimal activeItems = data.items().stream()
                    .filter(item -> item.orderId() == order.id() && !"cancelled".equals(item.status()))
                    .map(FloItem::total)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            if (!sameMoney(activeItems, bill.total()) || !sameMoney(order.total(), bill.total())) {
                throw new IllegalStateException("No cuadra el pedido Flo " + order.orderNumber());
            }
            BigDecimal payments = bill.payments().stream()
                    .map(PaymentDetail::amount)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            if (!sameMoney(payments, bill.total())) {
                throw new IllegalStateException("No cuadran los pagos de " + bill.billNumber());
            }
        }
        long completed = data.orders().stream().filter(order -> "completed".equals(order.status())).count();
        long cancelled = data.orders().stream().filter(order -> "cancelled".equals(order.status())).count();
        if (completed != 98 || cancelled != 7 || billsByOrder.size() != 98) {
            throw new IllegalStateException("Los estados de pedidos Flo no coinciden con el análisis aprobado");
        }

        Set<String> referencedProducts = data.items().stream().map(FloItem::productId).collect(Collectors.toSet());
        List<Product> importedProducts = data.products().stream()
                .filter(product -> product.deletedAt() == null || referencedProducts.contains(product.id()))
                .toList();
        Map<String, String> productSkus = assignSkus(importedProducts);

        UUID organizationId = stableUuid(storeId, "organization", storeId);
        UUID locationId = stableUuid(storeId, "location", "main");
        UUID importId = stableUuid(storeId, "import", data.fingerprint());
        return new ImportPlan(data, importedProducts, productSkus, organizationId, locationId, importId);
    }

    private void importAll(ImportPlan plan) {
        if (exists("""
                SELECT COUNT(*) FROM external_import_batches
                WHERE source_system = :sourceSystem AND source_fingerprint = :fingerprint
                """, params("sourceSystem", SOURCE_SYSTEM, "fingerprint", plan.data().fingerprint()))) {
            throw new IllegalStateException("Esta copia Flo ya fue importada");
        }
        if (exists("SELECT COUNT(*) FROM organizations WHERE slug = :slug", params("slug", "obelisco"))) {
            throw new IllegalStateException("Ya existe una organización con slug obelisco; no se mezclaron datos");
        }
        for (FloUser user : plan.data().users()) {
            if (exists("SELECT COUNT(*) FROM app_users WHERE normalized_email = :email",
                    params("email", user.email().trim().toLowerCase(Locale.ROOT)))) {
                throw new IllegalStateException("El correo ya existe en SGR: " + user.email());
            }
        }

        insertOrganization(plan);
        insertUsers(plan);
        insertAreasAndCategories(plan);
        insertProducts(plan);
        insertTables(plan);
        insertImportBatch(plan);
        insertOrdersAndItems(plan);
        insertCashShifts(plan);
        insertPaymentsAndRefunds(plan);
        insertAudit(plan);
    }

    private void insertOrganization(ImportPlan plan) {
        target.update("""
                INSERT INTO organizations (id, name, slug, timezone, currency)
                VALUES (:id, :name, :slug, :timezone, :currency)
                """, params(
                "id", plan.organizationId(), "name", EXPECTED_BUSINESS, "slug", "obelisco",
                "timezone", BUSINESS_ZONE.getId(), "currency", "EUR"
        ));
        target.update("""
                INSERT INTO locations (id, organization_id, name, code, timezone)
                VALUES (:id, :organizationId, :name, :code, :timezone)
                """, params(
                "id", plan.locationId(), "organizationId", plan.organizationId(),
                "name", "Obelisco Garrucha", "code", "GARRUCHA",
                "timezone", BUSINESS_ZONE.getId()
        ));
    }

    private void insertUsers(ImportPlan plan) {
        for (FloUser user : plan.data().users()) {
            UUID id = id(plan, "user", user.id());
            target.update("""
                    INSERT INTO app_users (
                        id, email, normalized_email, password_hash, display_name,
                        active, created_at, updated_at
                    ) VALUES (
                        :id, :email, :normalizedEmail, :passwordHash, :displayName,
                        :active, :createdAt, :updatedAt
                    )
                    """, params(
                    "id", id, "email", user.email().trim(),
                    "normalizedEmail", user.email().trim().toLowerCase(Locale.ROOT),
                    "passwordHash", user.passwordHash(), "displayName", user.name(),
                    "active", user.active(), "createdAt", timestamp(user.createdAt()),
                    "updatedAt", timestamp(user.updatedAt())
            ));
            target.update("""
                    INSERT INTO user_organizations (user_id, organization_id, role, active, created_at)
                    VALUES (:userId, :organizationId, :role, :active, :createdAt)
                    """, params(
                    "userId", id, "organizationId", plan.organizationId(),
                    "role", role(user.role()), "active", user.active(),
                    "createdAt", timestamp(user.createdAt())
            ));
        }
    }

    private void insertAreasAndCategories(ImportPlan plan) {
        Map<String, Integer> areaOrder = Map.of("Sala", 0, "Terraza", 1, "Pedidos externos", 2);
        for (Map.Entry<String, Integer> area : areaOrder.entrySet()) {
            boolean active = !"Pedidos externos".equals(area.getKey());
            target.update("""
                    INSERT INTO dining_areas (
                        id, organization_id, location_id, name, sort_order, active
                    ) VALUES (
                        :id, :organizationId, :locationId, :name, :sortOrder, :active
                    )
                    """, params(
                    "id", id(plan, "area", area.getKey()), "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(), "name", area.getKey(),
                    "sortOrder", area.getValue(), "active", active
            ));
        }

        Set<String> usedCodes = new HashSet<>();
        for (Category category : plan.data().categories()) {
            if (category.deletedAt() != null) {
                continue;
            }
            String code = uniqueCode(category.name(), usedCodes);
            target.update("""
                    INSERT INTO menu_categories (
                        id, organization_id, location_id, name, code, sort_order,
                        active, created_at, updated_at
                    ) VALUES (
                        :id, :organizationId, :locationId, :name, :code, :sortOrder,
                        :active, :createdAt, :updatedAt
                    )
                    """, params(
                    "id", id(plan, "category", category.id()),
                    "organizationId", plan.organizationId(), "locationId", plan.locationId(),
                    "name", category.name(), "code", code, "sortOrder", Math.max(0, category.sortOrder()),
                    "active", category.active(), "createdAt", timestamp(category.createdAt()),
                    "updatedAt", timestamp(category.updatedAt())
            ));
        }
        target.update("""
                INSERT INTO menu_categories (
                    id, organization_id, location_id, name, code, sort_order, active
                ) VALUES (
                    :id, :organizationId, :locationId, :name, :code, :sortOrder, 0
                )
                """, params(
                "id", id(plan, "category", "historical"),
                "organizationId", plan.organizationId(), "locationId", plan.locationId(),
                "name", "Productos históricos de Flo", "code", "HISTORICO", "sortOrder", 999
        ));
    }

    private void insertProducts(ImportPlan plan) {
        Map<String, Category> categories = index(plan.data().categories(), Category::id);
        for (Product product : plan.products()) {
            Category category = categories.get(product.categoryId());
            boolean historical = product.deletedAt() != null || category == null || category.deletedAt() != null;
            UUID categoryId = historical
                    ? id(plan, "category", "historical")
                    : id(plan, "category", category.id());
            target.update("""
                    INSERT INTO products (
                        id, organization_id, location_id, category_id, name, sku,
                        description, price, tax_rate, available, active,
                        created_at, updated_at
                    ) VALUES (
                        :id, :organizationId, :locationId, :categoryId, :name, :sku,
                        :description, :price, 0, :available, :active,
                        :createdAt, :updatedAt
                    )
                    """, params(
                    "id", id(plan, "product", product.id()), "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(), "categoryId", categoryId,
                    "name", product.name(), "sku", plan.productSkus().get(product.id()),
                    "description", product.description(), "price", money(product.price()),
                    "available", !historical && product.active(), "active", !historical && product.active(),
                    "createdAt", timestamp(product.createdAt()), "updatedAt", timestamp(product.updatedAt())
            ));
        }
    }

    private void insertTables(ImportPlan plan) {
        for (FloTable table : plan.data().tables()) {
            if (!table.active()) {
                continue;
            }
            String area = "Terraza".equalsIgnoreCase(table.section())
                    || "Terraza".equalsIgnoreCase(table.floor()) ? "Terraza" : "Sala";
            target.update("""
                    INSERT INTO dining_tables (
                        id, organization_id, location_id, area_id, code, name,
                        capacity, status, active, created_at, updated_at
                    ) VALUES (
                        :id, :organizationId, :locationId, :areaId, :code, :name,
                        :capacity, 'FREE', 1, :createdAt, :updatedAt
                    )
                    """, params(
                    "id", id(plan, "table", table.id()), "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(), "areaId", id(plan, "area", area),
                    "code", tableCode(table.number()), "name", table.number(),
                    "capacity", Math.max(1, table.capacity()),
                    "createdAt", timestamp(table.createdAt()), "updatedAt", timestamp(table.updatedAt())
            ));
        }
        target.update("""
                INSERT INTO dining_tables (
                    id, organization_id, location_id, area_id, code, name,
                    capacity, status, active
                ) VALUES (
                    :id, :organizationId, :locationId, :areaId, 'PARA-LLEVAR',
                    'Para llevar (histórico)', 1, 'OUT_OF_SERVICE', 0
                )
                """, params(
                "id", id(plan, "table", "takeaway"), "organizationId", plan.organizationId(),
                "locationId", plan.locationId(), "areaId", id(plan, "area", "Pedidos externos")
        ));
        target.update("""
                INSERT INTO dining_tables (
                    id, organization_id, location_id, area_id, code, name,
                    capacity, status, active
                ) VALUES (
                    :id, :organizationId, :locationId, :areaId, 'FLO-HISTORICO',
                    'Mesa histórica de Flo', 1, 'OUT_OF_SERVICE', 0
                )
                """, params(
                "id", id(plan, "table", "historical"), "organizationId", plan.organizationId(),
                "locationId", plan.locationId(), "areaId", id(plan, "area", "Pedidos externos")
        ));
    }

    private void insertImportBatch(ImportPlan plan) {
        Map<String, Object> summary = new LinkedHashMap<>();
        summary.put("business", EXPECTED_BUSINESS);
        summary.put("storeId", EXPECTED_STORE_ID);
        summary.put("sourceAppVersion", plan.data().meta().get("app_version"));
        summary.put("users", plan.data().users().size());
        summary.put("products", plan.products().size());
        summary.put("orders", plan.data().orders().size());
        summary.put("items", plan.data().items().size());
        summary.put("bills", plan.data().bills().size());
        summary.put("refunds", plan.data().refunds().size());
        BigDecimal importedPaidTotal = plan.data().bills().stream()
                .map(Bill::total)
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        summary.put("paidTotal", money(importedPaidTotal));
        target.update("""
                INSERT INTO external_import_batches (
                    id, organization_id, source_system, source_fingerprint,
                    source_created_at, source_schema_version, summary_json
                ) VALUES (
                    :id, :organizationId, :sourceSystem, :fingerprint,
                    :sourceCreatedAt, :schemaVersion, :summaryJson
                )
                """, params(
                "id", plan.importId(), "organizationId", plan.organizationId(),
                "sourceSystem", SOURCE_SYSTEM, "fingerprint", plan.data().fingerprint(),
                "sourceCreatedAt", Timestamp.from(Instant.parse(plan.data().meta().get("backup_created_at"))),
                "schemaVersion", Integer.toString(plan.data().userVersion()),
                "summaryJson", json(summary)
        ));
        mapping(plan, "organization", EXPECTED_STORE_ID, plan.organizationId(), EXPECTED_BUSINESS);
        mapping(plan, "location", "main", plan.locationId(), "Obelisco Garrucha");
        for (FloUser user : plan.data().users()) {
            mapping(plan, "user", user.id(), id(plan, "user", user.id()), user.email());
        }
        for (Category category : plan.data().categories()) {
            if (category.deletedAt() == null) {
                mapping(plan, "category", category.id(), id(plan, "category", category.id()), category.name());
            }
        }
        for (Product product : plan.products()) {
            mapping(plan, "product", product.id(), id(plan, "product", product.id()), plan.productSkus().get(product.id()));
        }
        for (FloTable table : plan.data().tables()) {
            UUID targetTable = table.active()
                    ? id(plan, "table", table.id())
                    : id(plan, "table", "historical");
            mapping(plan, "table", table.id(), targetTable, table.number());
        }
    }

    private void insertOrdersAndItems(ImportPlan plan) {
        Map<Long, Bill> bills = index(plan.data().bills(), Bill::orderId);
        Set<Long> refundedBills = plan.data().refunds().stream()
                .map(Refund::billId).collect(Collectors.toSet());
        Map<Long, List<ItemAddon>> addonsByItem = plan.data().addons().stream()
                .collect(Collectors.groupingBy(ItemAddon::orderItemId));
        Map<Long, FloOrder> orders = index(plan.data().orders(), FloOrder::id);
        Map<String, Product> products = index(plan.products(), Product::id);
        Map<String, FloTable> tables = index(plan.data().tables(), FloTable::id);

        for (FloOrder order : plan.data().orders()) {
            Bill bill = bills.get(order.id());
            String status = "cancelled".equals(order.status())
                    ? "CANCELLED"
                    : bill != null && refundedBills.contains(bill.id()) ? "REFUNDED" : "PAID";
            boolean takeaway = "takeaway".equals(order.type()) || order.tableId() == null;
            String notes = joinNotes(
                    order.specialInstructions(),
                    "Importado de Flo: " + order.orderNumber()
                            + ("TAKEAWAY".equals(takeaway ? "TAKEAWAY" : "DINE_IN") ? " · para llevar" : "")
            );
            String closedText = firstNonBlank(
                    "CANCELLED".equals(status) ? order.cancelledAt() : null,
                    bill == null ? null : bill.paidAt(),
                    order.completedAt(), order.updatedAt()
            );
            FloTable sourceTable = order.tableId() == null ? null : tables.get(order.tableId());
            UUID targetTableId = takeaway
                    ? id(plan, "table", "takeaway")
                    : sourceTable != null && sourceTable.active()
                            ? id(plan, "table", sourceTable.id())
                            : id(plan, "table", "historical");
            UUID orderId = id(plan, "order", Long.toString(order.id()));
            target.update("""
                    INSERT INTO restaurant_orders (
                        id, organization_id, location_id, table_id, status,
                        guest_count, notes, opened_by_user_id, opened_at, closed_at,
                        updated_at, order_type, external_reference, source_total
                    ) VALUES (
                        :id, :organizationId, :locationId, :tableId, :status,
                        :guestCount, :notes, :openedBy, :openedAt, :closedAt,
                        :updatedAt, :orderType, :externalReference, :sourceTotal
                    )
                    """, params(
                    "id", orderId, "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(),
                    "tableId", targetTableId,
                    "status", status, "guestCount", order.guestCount() == null ? 1 : order.guestCount(),
                    "notes", notes, "openedBy", id(plan, "user", order.userId()),
                    "openedAt", timestamp(order.createdAt()), "closedAt", timestamp(closedText),
                    "updatedAt", timestamp(order.updatedAt()),
                    "orderType", takeaway ? "TAKEAWAY" : "DINE_IN",
                    "externalReference", order.orderNumber(), "sourceTotal", money(order.total())
            ));
            mapping(plan, "order", Long.toString(order.id()), orderId, order.orderNumber());
        }

        for (FloItem item : plan.data().items()) {
            FloOrder order = orders.get(item.orderId());
            Product product = products.get(item.productId());
            boolean voided = "cancelled".equals(item.status()) || "cancelled".equals(order.status());
            String addonNote = addonsByItem.getOrDefault(item.id(), List.of()).stream()
                    .map(addon -> addon.addonName() + (addon.quantity() > 1 ? " x" + addon.quantity() : ""))
                    .collect(Collectors.joining(", "));
            String note = joinNotes(
                    item.specialInstructions(),
                    addonNote.isBlank() ? null : "Opción Flo: " + addonNote
            );
            Timestamp voidedAt = voided
                    ? timestamp(firstNonBlank(item.voidedAt(), order.cancelledAt(), item.updatedAt()))
                    : null;
            UUID itemId = id(plan, "order-item", Long.toString(item.id()));
            target.update("""
                    INSERT INTO order_items (
                        id, organization_id, order_id, product_id, product_name,
                        sku, quantity, unit_price, tax_rate, kitchen_note,
                        sent_to_kitchen_at, voided_at, void_reason, voided_by_user_id,
                        created_by_user_id, created_at
                    ) VALUES (
                        :id, :organizationId, :orderId, :productId, :productName,
                        :sku, :quantity, :unitPrice, 0, :kitchenNote,
                        :sentAt, :voidedAt, :voidReason, :voidedBy,
                        :createdBy, :createdAt
                    )
                    """, params(
                    "id", itemId, "organizationId", plan.organizationId(),
                    "orderId", id(plan, "order", Long.toString(item.orderId())),
                    "productId", id(plan, "product", item.productId()),
                    "productName", item.productName(),
                    "sku", product == null ? generatedHistoricalSku(item.productId()) : plan.productSkus().get(product.id()),
                    "quantity", item.quantity(), "unitPrice", money(item.unitPrice()),
                    "kitchenNote", note, "sentAt", voided ? null : timestamp(item.createdAt()),
                    "voidedAt", voidedAt,
                    "voidReason", voided ? firstNonBlank(order.cancellationReason(), "Anulado en Flo") : null,
                    "voidedBy", voided ? id(plan, "user", order.userId()) : null,
                    "createdBy", id(plan, "user", order.userId()), "createdAt", timestamp(item.createdAt())
            ));
            mapping(plan, "order_item", Long.toString(item.id()), itemId, item.productName());
        }
    }

    private void insertCashShifts(ImportPlan plan) {
        Map<LocalDate, ShiftTotals> totals = shiftTotals(plan.data());
        UUID ownerId = id(plan, "user", owner(plan.data()).id());
        for (Map.Entry<LocalDate, ShiftTotals> entry : totals.entrySet()) {
            LocalDate day = entry.getKey();
            ShiftTotals sum = entry.getValue();
            BigDecimal expectedCash = money(sum.cashSales().subtract(sum.cashRefunds()));
            UUID shiftId = id(plan, "cash-shift", day.toString());
            target.update("""
                    INSERT INTO cash_shifts (
                        id, organization_id, location_id, status, opening_amount,
                        opened_by_user_id, opened_at, closing_counted_cash,
                        expected_cash, cash_difference, cash_sales_total,
                        card_sales_total, cash_refunds_total, card_refunds_total,
                        paid_in_total, paid_out_total, closed_by_user_id, closed_at,
                        closing_note, idempotency_key, version
                    ) VALUES (
                        :id, :organizationId, :locationId, 'CLOSED', 0,
                        :ownerId, :openedAt, :expectedCash,
                        :expectedCash, 0, :cashSales,
                        :cardSales, :cashRefunds, :cardRefunds,
                        0, 0, :ownerId, :closedAt,
                        :closingNote, :idempotencyKey, 1
                    )
                    """, params(
                    "id", shiftId, "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(), "ownerId", ownerId,
                    "openedAt", timestamp(day.atStartOfDay()),
                    "closedAt", timestamp(day.atTime(LocalTime.MAX)),
                    "expectedCash", expectedCash, "cashSales", money(sum.cashSales()),
                    "cardSales", money(sum.cardSales()), "cashRefunds", money(sum.cashRefunds()),
                    "cardRefunds", money(sum.cardRefunds()),
                    "closingNote", "Cierre histórico reconstruido desde Flo",
                    "idempotencyKey", stableUuid(EXPECTED_STORE_ID, "cash-shift-idempotency", day.toString())
            ));
            mapping(plan, "cash_shift", day.toString(), shiftId, "Flo " + day);
        }
    }

    private void insertPaymentsAndRefunds(ImportPlan plan) {
        Map<Long, FloOrder> orders = index(plan.data().orders(), FloOrder::id);
        Map<Long, Bill> bills = index(plan.data().bills(), Bill::id);
        Map<Long, List<PaymentTarget>> paymentsByBill = new HashMap<>();

        for (Bill bill : plan.data().bills()) {
            FloOrder order = orders.get(bill.orderId());
            List<PaymentTarget> paymentTargets = new ArrayList<>();
            for (int index = 0; index < bill.payments().size(); index++) {
                PaymentDetail payment = bill.payments().get(index);
                String sourceId = bill.id() + ":" + index;
                UUID paymentId = id(plan, "payment", sourceId);
                Timestamp paidAt = timestamp(firstNonBlank(payment.timestamp(), bill.paidAt()));
                LocalDate day = paidAt.toInstant().atZone(BUSINESS_ZONE).toLocalDate();
                String method = payment.method().toUpperCase(Locale.ROOT);
                BigDecimal tendered = "CASH".equals(method)
                        ? (payment.tenderedAmount() == null ? payment.amount() : payment.tenderedAmount())
                        : null;
                target.update("""
                        INSERT INTO order_payments (
                            id, organization_id, location_id, order_id, method,
                            amount, tendered_amount, change_amount, external_reference,
                            idempotency_key, status, paid_by_user_id, paid_at, cash_shift_id
                        ) VALUES (
                            :id, :organizationId, :locationId, :orderId, :method,
                            :amount, :tenderedAmount, :changeAmount, :externalReference,
                            :idempotencyKey, 'COMPLETED', :paidBy, :paidAt, :cashShiftId
                        )
                        """, params(
                        "id", paymentId, "organizationId", plan.organizationId(),
                        "locationId", plan.locationId(),
                        "orderId", id(plan, "order", Long.toString(order.id())),
                        "method", method, "amount", money(payment.amount()),
                        "tenderedAmount", tendered == null ? null : money(tendered),
                        "changeAmount", money(payment.changeAmount() == null ? BigDecimal.ZERO : payment.changeAmount()),
                        "externalReference", "Flo " + bill.billNumber(),
                        "idempotencyKey", stableUuid(EXPECTED_STORE_ID, "payment-idempotency", sourceId),
                        "paidBy", id(plan, "user", order.userId()), "paidAt", paidAt,
                        "cashShiftId", id(plan, "cash-shift", day.toString())
                ));
                mapping(plan, "payment", sourceId, paymentId, bill.billNumber());
                paymentTargets.add(new PaymentTarget(paymentId, method));
            }
            paymentsByBill.put(bill.id(), paymentTargets);
        }

        for (Refund refund : plan.data().refunds()) {
            Bill bill = bills.get(refund.billId());
            FloOrder order = orders.get(bill.orderId());
            String method = refund.method().toUpperCase(Locale.ROOT);
            PaymentTarget payment = paymentsByBill.get(refund.billId()).stream()
                    .filter(candidate -> method.equals(candidate.method()))
                    .findFirst()
                    .orElseThrow(() -> new IllegalStateException("No hay pago para el reembolso Flo " + refund.id()));
            LocalDate day = localDate(refund.createdAt());
            UUID refundId = id(plan, "refund", Long.toString(refund.id()));
            target.update("""
                    INSERT INTO payment_refunds (
                        id, organization_id, location_id, order_id, payment_id,
                        cash_shift_id, method, amount, reason, idempotency_key,
                        refunded_by_user_id, refunded_at
                    ) VALUES (
                        :id, :organizationId, :locationId, :orderId, :paymentId,
                        :cashShiftId, :method, :amount, :reason, :idempotencyKey,
                        :refundedBy, :refundedAt
                    )
                    """, params(
                    "id", refundId, "organizationId", plan.organizationId(),
                    "locationId", plan.locationId(),
                    "orderId", id(plan, "order", Long.toString(order.id())),
                    "paymentId", payment.id(), "cashShiftId", id(plan, "cash-shift", day.toString()),
                    "method", method, "amount", money(refund.amount()),
                    "reason", "Flo " + refund.kind() + ": " + firstNonBlank(refund.reason(), "sin motivo"),
                    "idempotencyKey", stableUuid(EXPECTED_STORE_ID, "refund-idempotency", Long.toString(refund.id())),
                    "refundedBy", id(plan, "user", refund.createdBy()),
                    "refundedAt", timestamp(refund.createdAt())
            ));
            mapping(plan, "refund", Long.toString(refund.id()), refundId, bill.billNumber());
        }
    }

    private void insertAudit(ImportPlan plan) {
        target.update("""
                INSERT INTO audit_events (
                    organization_id, actor_user_id, event_type, entity_type,
                    entity_id, details_json, occurred_at
                ) VALUES (
                    :organizationId, :actorId, 'EXTERNAL_IMPORT_COMPLETED',
                    'external_import_batch', :entityId, :details, SYSUTCDATETIME()
                )
                """, params(
                "organizationId", plan.organizationId(),
                "actorId", id(plan, "user", owner(plan.data()).id()),
                "entityId", plan.importId().toString(),
                "details", json(Map.of(
                        "sourceSystem", SOURCE_SYSTEM,
                        "fingerprint", plan.data().fingerprint(),
                        "orders", plan.data().orders().size(),
                        "bills", plan.data().bills().size()
                ))
        ));
    }

    private void verifyImport(ImportPlan plan) {
        MapSqlParameterSource organization = params("organizationId", plan.organizationId());
        assertCount("lotes", 1, """
                SELECT COUNT(*) FROM external_import_batches
                WHERE organization_id = :organizationId
                  AND source_system = 'FLO_POS'
                  AND source_fingerprint = :fingerprint
                """, params(
                "organizationId", plan.organizationId(),
                "fingerprint", plan.data().fingerprint()
        ));
        assertCount("usuarios", 4, """
                SELECT COUNT(*) FROM user_organizations
                WHERE organization_id = :organizationId AND active = 1
                """, organization);
        assertCount("productos", 137, """
                SELECT COUNT(*) FROM products WHERE organization_id = :organizationId
                """, organization);
        assertCount("productos activos", 135, """
                SELECT COUNT(*) FROM products
                WHERE organization_id = :organizationId AND active = 1
                """, organization);
        assertCount("mesas activas", 13, """
                SELECT COUNT(*) FROM dining_tables
                WHERE organization_id = :organizationId AND active = 1
                """, organization);
        assertCount("pedidos", 105, """
                SELECT COUNT(*) FROM restaurant_orders WHERE organization_id = :organizationId
                """, organization);
        assertCount("pedidos pagados", 97, """
                SELECT COUNT(*) FROM restaurant_orders
                WHERE organization_id = :organizationId AND status = 'PAID'
                """, organization);
        assertCount("pedidos reembolsados", 1, """
                SELECT COUNT(*) FROM restaurant_orders
                WHERE organization_id = :organizationId AND status = 'REFUNDED'
                """, organization);
        assertCount("pedidos anulados", 7, """
                SELECT COUNT(*) FROM restaurant_orders
                WHERE organization_id = :organizationId AND status = 'CANCELLED'
                """, organization);
        assertCount("partidas", 318, """
                SELECT COUNT(*) FROM order_items WHERE organization_id = :organizationId
                """, organization);
        assertCount("partidas anuladas", 30, """
                SELECT COUNT(*) FROM order_items
                WHERE organization_id = :organizationId AND voided_at IS NOT NULL
                """, organization);
        assertCount("pagos", 98, """
                SELECT COUNT(*) FROM order_payments WHERE organization_id = :organizationId
                """, organization);
        assertCount("reembolsos", 1, """
                SELECT COUNT(*) FROM payment_refunds WHERE organization_id = :organizationId
                """, organization);
        assertCount("turnos de caja", 11, """
                SELECT COUNT(*) FROM cash_shifts WHERE organization_id = :organizationId
                """, organization);
        assertMoney("total cobrado", new BigDecimal("2777.28"), """
                SELECT COALESCE(SUM(amount), 0) FROM order_payments
                WHERE organization_id = :organizationId AND status = 'COMPLETED'
                """, organization);
        assertMoney("efectivo", new BigDecimal("1585.62"), """
                SELECT COALESCE(SUM(amount), 0) FROM order_payments
                WHERE organization_id = :organizationId AND method = 'CASH'
                """, organization);
        assertMoney("tarjeta", new BigDecimal("1191.66"), """
                SELECT COALESCE(SUM(amount), 0) FROM order_payments
                WHERE organization_id = :organizationId AND method = 'CARD'
                """, organization);
        assertMoney("reembolsado", new BigDecimal("27.50"), """
                SELECT COALESCE(SUM(amount), 0) FROM payment_refunds
                WHERE organization_id = :organizationId
                """, organization);
        assertMoney("venta bruta reconstruida", new BigDecimal("2777.28"), """
                SELECT COALESCE(SUM(CAST(i.quantity * i.unit_price AS DECIMAL(19,4))), 0)
                FROM order_items i
                INNER JOIN restaurant_orders o ON o.id = i.order_id
                WHERE i.organization_id = :organizationId
                  AND i.voided_at IS NULL
                  AND o.status IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED')
                """, organization);
        assertCount("SKU duplicados", 0, """
                SELECT COUNT(*) FROM (
                    SELECT sku FROM products
                    WHERE organization_id = :organizationId
                    GROUP BY sku HAVING COUNT(*) > 1
                ) duplicated
                """, organization);
        log.info("""
                FLO_IMPORT_VERIFIED organizationId={}
                  users=4 products=137 activeProducts=135 activeTables=13
                  orders=105 paid=97 refunded=1 cancelled=7 items=318 voidedItems=30
                  payments=98 paidTotal=2777.2800 cash=1585.6200 card=1191.6600
                  refunds=1 refundedTotal=27.5000 cashShifts=11 duplicateSkus=0
                """, plan.organizationId());
    }

    private void assertCount(
            String label,
            int expected,
            String sql,
            MapSqlParameterSource parameters
    ) {
        Integer actual = target.queryForObject(sql, parameters, Integer.class);
        if (actual == null || actual != expected) {
            throw new IllegalStateException(
                    "Verificación fallida para " + label + ": esperado=" + expected + ", real=" + actual
            );
        }
    }

    private void assertMoney(
            String label,
            BigDecimal expected,
            String sql,
            MapSqlParameterSource parameters
    ) {
        BigDecimal actual = target.queryForObject(sql, parameters, BigDecimal.class);
        if (actual == null || !sameMoney(expected, actual)) {
            throw new IllegalStateException(
                    "Verificación fallida para " + label + ": esperado=" + expected + ", real=" + actual
            );
        }
    }

    private Map<LocalDate, ShiftTotals> shiftTotals(FloData data) {
        Map<LocalDate, MutableShiftTotals> totals = new LinkedHashMap<>();
        for (Bill bill : data.bills()) {
            for (PaymentDetail payment : bill.payments()) {
                LocalDate day = localDate(firstNonBlank(payment.timestamp(), bill.paidAt()));
                MutableShiftTotals sum = totals.computeIfAbsent(day, ignored -> new MutableShiftTotals());
                if ("cash".equalsIgnoreCase(payment.method())) {
                    sum.cashSales = sum.cashSales.add(payment.amount());
                } else if ("card".equalsIgnoreCase(payment.method())) {
                    sum.cardSales = sum.cardSales.add(payment.amount());
                } else {
                    throw new IllegalStateException("Método de pago Flo no soportado: " + payment.method());
                }
            }
        }
        for (Refund refund : data.refunds()) {
            LocalDate day = localDate(refund.createdAt());
            MutableShiftTotals sum = totals.computeIfAbsent(day, ignored -> new MutableShiftTotals());
            if ("cash".equalsIgnoreCase(refund.method())) {
                sum.cashRefunds = sum.cashRefunds.add(refund.amount());
            } else if ("card".equalsIgnoreCase(refund.method())) {
                sum.cardRefunds = sum.cardRefunds.add(refund.amount());
            }
        }
        return totals.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .collect(Collectors.toMap(
                        Map.Entry::getKey,
                        entry -> entry.getValue().freeze(),
                        (left, right) -> left,
                        LinkedHashMap::new
                ));
    }

    private void mapping(ImportPlan plan, String type, String sourceId, UUID targetId, String reference) {
        target.update("""
                INSERT INTO external_entity_mappings (
                    import_id, entity_type, source_id, target_id, source_reference
                ) VALUES (
                    :importId, :entityType, :sourceId, :targetId, :sourceReference
                )
                """, params(
                "importId", plan.importId(), "entityType", type, "sourceId", sourceId,
                "targetId", targetId, "sourceReference", truncate(reference, 240)
        ));
    }

    private void logPlan(ImportPlan plan, String mode) {
        BigDecimal paid = plan.data().bills().stream()
                .map(Bill::total).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal refunded = plan.data().refunds().stream()
                .map(Refund::amount).reduce(BigDecimal.ZERO, BigDecimal::add);
        long generatedSkus = plan.productSkus().entrySet().stream()
                .filter(entry -> {
                    Product product = plan.products().stream()
                            .filter(candidate -> candidate.id().equals(entry.getKey())).findFirst().orElseThrow();
                    return product.sku() == null || product.sku().isBlank();
                }).count();
        log.info("""
                FLO_IMPORT_PLAN mode={}
                  source={} schema={} app={} fingerprint={}
                  organization={} location=Obelisco Garrucha
                  users={} products={} generatedSkus={} tables={} orders={} items={}
                  bills={} paid={} refunds={} refunded={} cashShifts={}
                  exclusions=customers,printers,kitchen-history,cloud-secrets,loyalty,whatsapp
                """,
                mode, plan.data().meta().get("backup_created_at"), plan.data().userVersion(),
                plan.data().meta().get("app_version"), plan.data().fingerprint(),
                EXPECTED_BUSINESS, plan.data().users().size(), plan.products().size(),
                generatedSkus, plan.data().tables().stream().filter(FloTable::active).count(),
                plan.data().orders().size(), plan.data().items().size(),
                plan.data().bills().size(), money(paid), plan.data().refunds().size(),
                money(refunded), shiftTotals(plan.data()).size());
    }

    private List<PaymentDetail> parsePayments(String json) {
        try {
            List<PaymentDetail> details = objectMapper.readValue(json, PAYMENT_DETAILS);
            if (details == null || details.isEmpty()) {
                throw new IllegalStateException("Cuenta Flo sin detalle de pago");
            }
            return details;
        } catch (IOException error) {
            throw new IllegalStateException("Detalle de pago Flo inválido", error);
        }
    }

    private static Map<String, String> assignSkus(List<Product> products) {
        Set<String> used = products.stream()
                .map(Product::sku)
                .filter(value -> value != null && !value.isBlank())
                .map(value -> value.trim().toUpperCase(Locale.ROOT))
                .collect(Collectors.toCollection(HashSet::new));
        int next = products.stream()
                .map(Product::sku)
                .filter(value -> value != null && value.toUpperCase(Locale.ROOT).matches("OBE-\\d{4}"))
                .mapToInt(value -> Integer.parseInt(value.substring(4)))
                .max().orElse(0) + 1;
        Map<String, String> result = new HashMap<>();
        List<Product> ordered = products.stream()
                .sorted(Comparator.comparing(Product::name, String.CASE_INSENSITIVE_ORDER)
                        .thenComparing(Product::id))
                .toList();
        for (Product product : ordered) {
            String sku = product.sku() == null ? "" : product.sku().trim().toUpperCase(Locale.ROOT);
            if (sku.isBlank()) {
                do {
                    sku = "OBE-%04d".formatted(next++);
                } while (used.contains(sku));
            }
            if (!used.add(sku) && (product.sku() == null || !sku.equals(product.sku().trim().toUpperCase(Locale.ROOT)))) {
                throw new IllegalStateException("SKU Flo duplicado: " + sku);
            }
            result.put(product.id(), sku);
        }
        if (result.values().stream().distinct().count() != result.size()) {
            throw new IllegalStateException("La asignación de SKU produjo duplicados");
        }
        return result;
    }

    static String uniqueCode(String name, Set<String> used) {
        String base = slug(name);
        String code = base;
        int suffix = 2;
        while (!used.add(code)) {
            String ending = "-" + suffix++;
            code = truncate(base, 40 - ending.length()) + ending;
        }
        return code;
    }

    static String slug(String value) {
        String normalized = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "")
                .toUpperCase(Locale.ROOT)
                .replaceAll("[^A-Z0-9]+", "-")
                .replaceAll("(^-|-$)", "");
        return truncate(normalized.isBlank() ? "SIN-CODIGO" : normalized, 40);
    }

    static UUID stableUuid(String storeId, String type, String sourceId) {
        return UUID.nameUUIDFromBytes(
                ("flo:" + storeId + ":" + type + ":" + sourceId).getBytes(StandardCharsets.UTF_8)
        );
    }

    private static UUID id(ImportPlan plan, String type, String sourceId) {
        return stableUuid(EXPECTED_STORE_ID, type, sourceId);
    }

    private static String tableCode(String number) {
        return truncate(slug(number), 40);
    }

    private static String generatedHistoricalSku(String productId) {
        return "FLO-HIST-" + productId.replace("-", "").substring(0, 8).toUpperCase(Locale.ROOT);
    }

    private static String role(String floRole) {
        return switch (floRole.toLowerCase(Locale.ROOT)) {
            case "owner" -> "OWNER";
            case "manager" -> "MANAGER";
            case "server" -> "SERVER";
            case "chef" -> "KITCHEN";
            default -> throw new IllegalStateException("Rol Flo no soportado: " + floRole);
        };
    }

    private static FloUser owner(FloData data) {
        return data.users().stream()
                .filter(user -> "owner".equalsIgnoreCase(user.role()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Flo no tiene propietario"));
    }

    private static Timestamp timestamp(String floValue) {
        if (floValue == null || floValue.isBlank()) {
            return null;
        }
        if (floValue.endsWith("Z") || floValue.contains("T") && floValue.matches(".*[+-]\\d\\d:\\d\\d$")) {
            return Timestamp.from(Instant.parse(floValue));
        }
        return timestamp(LocalDateTime.parse(floValue.replace('T', ' '), FLO_LOCAL));
    }

    private static Timestamp timestamp(LocalDateTime local) {
        return Timestamp.from(local.atZone(BUSINESS_ZONE).toInstant());
    }

    private static LocalDate localDate(String floValue) {
        return timestamp(floValue).toInstant().atZone(BUSINESS_ZONE).toLocalDate();
    }

    private static BigDecimal decimal(ResultSet rs, String column) throws SQLException {
        BigDecimal value = rs.getBigDecimal(column);
        return value == null ? BigDecimal.ZERO : value;
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(4, RoundingMode.HALF_UP);
    }

    private static boolean sameMoney(BigDecimal left, BigDecimal right) {
        return left.subtract(right).abs().compareTo(new BigDecimal("0.005")) < 0;
    }

    private static String text(ResultSet rs, String column) throws SQLException {
        String value = rs.getString(column);
        return value == null || value.isBlank() ? null : value.trim();
    }

    private static Integer nullableInt(ResultSet rs, String column) throws SQLException {
        int value = rs.getInt(column);
        return rs.wasNull() ? null : value;
    }

    private static String joinNotes(String first, String second) {
        String left = first == null || first.isBlank() ? null : first.trim();
        String right = second == null || second.isBlank() ? null : second.trim();
        if (left == null) return truncate(right, 500);
        if (right == null) return truncate(left, 500);
        return truncate(left + " · " + right, 500);
    }

    private static String firstNonBlank(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }

    private static String truncate(String value, int max) {
        if (value == null || value.length() <= max) return value;
        return value.substring(0, max);
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (IOException error) {
            throw new IllegalStateException("No se pudo serializar el resumen de importación", error);
        }
    }

    private boolean exists(String sql, MapSqlParameterSource parameters) {
        Integer count = target.queryForObject(sql, parameters, Integer.class);
        return count != null && count > 0;
    }

    private static MapSqlParameterSource params(Object... entries) {
        MapSqlParameterSource result = new MapSqlParameterSource();
        for (int index = 0; index < entries.length; index += 2) {
            result.addValue((String) entries[index], entries[index + 1]);
        }
        return result;
    }

    private String requiredProperty(String name) {
        String value = environment.getProperty(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Falta " + name);
        }
        return value.trim();
    }

    private static String sha256(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (var input = Files.newInputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) >= 0) {
                    digest.update(buffer, 0, read);
                }
            }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 no está disponible", impossible);
        }
    }

    private static Map<String, String> keyValues(Connection db, String table) throws SQLException {
        Map<String, String> result = new HashMap<>();
        try (var statement = db.createStatement();
             var rows = statement.executeQuery("SELECT key, value FROM " + table)) {
            while (rows.next()) {
                result.put(rows.getString("key"), rows.getString("value"));
            }
        }
        return result;
    }

    private static int scalarInt(Connection db, String sql) throws SQLException {
        try (var statement = db.createStatement(); var rows = statement.executeQuery(sql)) {
            if (!rows.next()) throw new SQLException("Consulta sin resultado: " + sql);
            return rows.getInt(1);
        }
    }

    private static <T> List<T> query(Connection db, String sql, SqlMapper<T> mapper) throws SQLException {
        List<T> result = new ArrayList<>();
        try (var statement = db.createStatement(); var rows = statement.executeQuery(sql)) {
            while (rows.next()) {
                result.add(mapper.map(rows));
            }
        }
        return result;
    }

    private static <K, V> Map<K, V> index(List<V> values, Function<V, K> key) {
        return values.stream().collect(Collectors.toMap(key, Function.identity()));
    }

    @FunctionalInterface
    private interface SqlMapper<T> {
        T map(ResultSet rows) throws SQLException;
    }

    private static final class MutableShiftTotals {
        private BigDecimal cashSales = BigDecimal.ZERO;
        private BigDecimal cardSales = BigDecimal.ZERO;
        private BigDecimal cashRefunds = BigDecimal.ZERO;
        private BigDecimal cardRefunds = BigDecimal.ZERO;

        private ShiftTotals freeze() {
            return new ShiftTotals(cashSales, cardSales, cashRefunds, cardRefunds);
        }
    }

    private record ImportPlan(
            FloData data,
            List<Product> products,
            Map<String, String> productSkus,
            UUID organizationId,
            UUID locationId,
            UUID importId
    ) { }

    private record FloData(
            String fingerprint,
            int userVersion,
            Map<String, String> meta,
            Map<String, String> settings,
            List<FloUser> users,
            List<Category> categories,
            List<Product> products,
            List<FloTable> tables,
            List<FloOrder> orders,
            List<FloItem> items,
            List<ItemAddon> addons,
            List<Bill> bills,
            List<Refund> refunds
    ) { }

    private record FloUser(
            String id, String name, String email, String passwordHash, String role,
            boolean active, String createdAt, String updatedAt
    ) { }

    private record Category(
            String id, String name, int sortOrder, boolean active, String deletedAt,
            String createdAt, String updatedAt
    ) { }

    private record Product(
            String id, String categoryId, String name, String description, BigDecimal price,
            String sku, boolean active, int sortOrder, String deletedAt,
            String createdAt, String updatedAt
    ) { }

    private record FloTable(
            String id, String number, int capacity, String status, String floor,
            String section, boolean active, String createdAt, String updatedAt
    ) { }

    private record FloOrder(
            long id, String orderNumber, String tableId, String userId, String type,
            Integer guestCount, String specialInstructions, String status, BigDecimal total,
            String completedAt, String cancelledAt, String cancellationReason,
            String createdAt, String updatedAt
    ) { }

    private record FloItem(
            long id, long orderId, String productId, String productName, String productSku,
            BigDecimal unitPrice, BigDecimal quantity, BigDecimal total,
            String specialInstructions, String status, String createdAt,
            String updatedAt, String voidedAt
    ) { }

    private record ItemAddon(long orderItemId, String addonName, BigDecimal price, int quantity) { }

    private record Bill(
            long id, String billNumber, long orderId, BigDecimal total, String paymentStatus,
            List<PaymentDetail> payments, String paidAt, String createdAt, String updatedAt
    ) { }

    private record PaymentDetail(
            String method,
            BigDecimal amount,
            @com.fasterxml.jackson.annotation.JsonProperty("tendered_amount") BigDecimal tenderedAmount,
            @com.fasterxml.jackson.annotation.JsonProperty("change_amount") BigDecimal changeAmount,
            String timestamp
    ) { }

    private record Refund(
            long id, long billId, BigDecimal amount, String method, String reason,
            String approvedBy, String createdBy, String createdAt, String kind
    ) { }

    private record ShiftTotals(
            BigDecimal cashSales,
            BigDecimal cardSales,
            BigDecimal cashRefunds,
            BigDecimal cardRefunds
    ) { }

    private record PaymentTarget(UUID id, String method) { }
}
