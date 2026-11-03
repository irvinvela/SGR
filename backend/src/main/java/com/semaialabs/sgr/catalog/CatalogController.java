package com.semaialabs.sgr.catalog;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/catalog")
public class CatalogController {
    private final JdbcClient jdbc;
    private final AuditService audit;

    public CatalogController(JdbcClient jdbc, AuditService audit) {
        this.jdbc = jdbc;
        this.audit = audit;
    }

    @GetMapping("/categories")
    public List<CategoryResponse> listCategories(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        return jdbc.sql("""
                SELECT id, location_id, name, code, sort_order
                FROM menu_categories
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                ORDER BY sort_order, name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new CategoryResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("name"),
                        rs.getString("code"),
                        rs.getInt("sort_order")
                ))
                .list();
    }

    @PostMapping("/categories")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public CategoryResponse createCategory(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateCategoryRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, request.locationId());
        UUID id = UUID.randomUUID();
        String code = normalizeCode(request.code());
        jdbc.sql("""
                INSERT INTO menu_categories (
                    id, organization_id, location_id, name, code, sort_order
                ) VALUES (
                    :id, :organizationId, :locationId, :name, :code, :sortOrder
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("name", request.name().trim())
                .param("code", code)
                .param("sortOrder", request.sortOrder())
                .update();
        audit.record(jwt, "MENU_CATEGORY_CREATED", "menu_category", id, Map.of("code", code));
        return new CategoryResponse(id, request.locationId(), request.name().trim(), code, request.sortOrder());
    }

    @GetMapping("/products")
    public List<ProductResponse> listProducts(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        return jdbc.sql("""
                SELECT
                    p.id, p.location_id, p.category_id, c.name AS category_name,
                    p.name, p.sku, p.description, p.price, p.tax_rate,
                    p.available, p.prep_station, p.version
                FROM products p
                INNER JOIN menu_categories c ON c.id = p.category_id
                WHERE p.organization_id = :organizationId
                  AND p.location_id = :locationId
                  AND p.active = 1
                  AND c.active = 1
                ORDER BY c.sort_order, c.name, p.name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query(this::mapProduct)
                .list();
    }

    @PostMapping("/products")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public ProductResponse createProduct(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateProductRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        String categoryName = requireCategory(organizationId, request.locationId(), request.categoryId());
        UUID id = UUID.randomUUID();
        String sku = normalizeCode(request.sku());
        String description = request.description() == null || request.description().isBlank()
                ? null
                : request.description().trim();
        String prepStation = inferPrepStation(categoryName, request.name());
        jdbc.sql("""
                INSERT INTO products (
                    id, organization_id, location_id, category_id,
                    name, sku, description, price, tax_rate, prep_station
                ) VALUES (
                    :id, :organizationId, :locationId, :categoryId,
                    :name, :sku, :description, :price, :taxRate, :prepStation
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("categoryId", request.categoryId())
                .param("name", request.name().trim())
                .param("sku", sku)
                .param("description", description)
                .param("price", request.price())
                .param("taxRate", request.taxRate())
                .param("prepStation", prepStation)
                .update();
        audit.record(jwt, "PRODUCT_CREATED", "product", id, Map.of("sku", sku));
        return new ProductResponse(
                id, request.locationId(), request.categoryId(), categoryName,
                request.name().trim(), sku, description, request.price(),
                request.taxRate(), true, prepStation, 0
        );
    }

    @PatchMapping("/products")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public ProductResponse updateProduct(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdateProductRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        ProductResponse current = findProduct(organizationId, request.productId());
        String categoryName = requireCategory(organizationId, current.locationId(), request.categoryId());
        String sku = normalizeCode(request.sku());
        String description = request.description() == null || request.description().isBlank()
                ? null
                : request.description().trim();
        int updated = jdbc.sql("""
                UPDATE products
                SET category_id = :categoryId,
                    name = :name,
                    sku = :sku,
                    description = :description,
                    price = :price,
                    tax_rate = :taxRate,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND active = 1
                """)
                .param("categoryId", request.categoryId())
                .param("name", request.name().trim())
                .param("sku", sku)
                .param("description", description)
                .param("price", request.price())
                .param("taxRate", request.taxRate())
                .param("id", request.productId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El producto cambió en otro dispositivo; actualice la vista"
            );
        }
        audit.record(
                jwt, "PRODUCT_UPDATED", "product", request.productId(),
                Map.of("sku", sku, "category", categoryName)
        );
        return findProduct(organizationId, request.productId());
    }

    @PatchMapping("/products/availability")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public ProductResponse changeAvailability(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ChangeAvailabilityRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        int updated = jdbc.sql("""
                UPDATE products
                SET available = :available,
                    version = version + 1,
                    updated_at = SYSUTCDATETIME()
                WHERE id = :id
                  AND organization_id = :organizationId
                  AND version = :expectedVersion
                  AND active = 1
                """)
                .param("available", request.available())
                .param("id", request.productId())
                .param("organizationId", organizationId)
                .param("expectedVersion", request.expectedVersion())
                .update();
        if (updated == 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "El producto cambió en otro dispositivo; actualice la vista"
            );
        }
        audit.record(
                jwt, "PRODUCT_AVAILABILITY_CHANGED", "product", request.productId(),
                Map.of("available", request.available())
        );
        return findProduct(organizationId, request.productId());
    }

    @PatchMapping("/products/prep-stations")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER', 'CASHIER', 'SERVER')")
    @Transactional
    public List<ProductResponse> updatePrepStations(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody UpdatePrepStationsRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, request.locationId());
        if (request.assignments() == null || request.assignments().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No hay productos para actualizar");
        }
        for (PrepStationAssignment assignment : request.assignments()) {
            String station = normalizeStation(assignment.station());
            int updated = jdbc.sql("""
                    UPDATE products
                    SET prep_station = :station,
                        version = version + 1,
                        updated_at = SYSUTCDATETIME()
                    WHERE id = :id
                      AND organization_id = :organizationId
                      AND location_id = :locationId
                      AND active = 1
                    """)
                    .param("station", station)
                    .param("id", assignment.productId())
                    .param("organizationId", organizationId)
                    .param("locationId", request.locationId())
                    .update();
            if (updated == 0) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Producto no encontrado");
            }
        }
        audit.record(
                jwt, "PRODUCT_PREP_STATIONS_UPDATED", "location", request.locationId(),
                Map.of("count", request.assignments().size())
        );
        return listProducts(jwt, request.locationId());
    }

    @GetMapping("/addon-groups")
    public List<AddonGroupResponse> listAddonGroups(
            @AuthenticationPrincipal Jwt jwt,
            @RequestParam UUID locationId
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, locationId);
        List<AddonGroupResponse> groups = jdbc.sql("""
                SELECT id, location_id, name, required, min_select, max_select, sort_order, version
                FROM addon_groups
                WHERE organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                ORDER BY sort_order, name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> new AddonGroupResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("name"),
                        rs.getBoolean("required"),
                        rs.getInt("min_select"),
                        rs.getInt("max_select"),
                        rs.getInt("sort_order"),
                        rs.getLong("version"),
                        List.of(),
                        List.of()
                ))
                .list();
        if (groups.isEmpty()) {
            return groups;
        }
        Map<UUID, List<AddonOptionResponse>> options = new HashMap<>();
        jdbc.sql("""
                SELECT o.id, o.group_id, o.name, o.price, o.available, o.sort_order
                FROM addon_options o
                INNER JOIN addon_groups g ON g.id = o.group_id
                WHERE o.organization_id = :organizationId
                  AND g.location_id = :locationId
                  AND o.active = 1
                ORDER BY o.sort_order, o.name
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> {
                    UUID groupId = rs.getObject("group_id", UUID.class);
                    options.computeIfAbsent(groupId, ignored -> new ArrayList<>()).add(new AddonOptionResponse(
                            rs.getObject("id", UUID.class),
                            groupId,
                            rs.getString("name"),
                            rs.getBigDecimal("price"),
                            rs.getBoolean("available"),
                            rs.getInt("sort_order")
                    ));
                    return groupId;
                })
                .list();
        Map<UUID, List<UUID>> products = new HashMap<>();
        jdbc.sql("""
                SELECT pg.group_id, pg.product_id
                FROM product_addon_groups pg
                INNER JOIN addon_groups g ON g.id = pg.group_id
                WHERE g.organization_id = :organizationId
                  AND g.location_id = :locationId
                  AND g.active = 1
                """)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query((rs, rowNum) -> {
                    UUID groupId = rs.getObject("group_id", UUID.class);
                    products.computeIfAbsent(groupId, ignored -> new ArrayList<>())
                            .add(rs.getObject("product_id", UUID.class));
                    return groupId;
                })
                .list();
        return groups.stream()
                .map(group -> new AddonGroupResponse(
                        group.id(),
                        group.locationId(),
                        group.name(),
                        group.required(),
                        group.minSelect(),
                        group.maxSelect(),
                        group.sortOrder(),
                        group.version(),
                        options.getOrDefault(group.id(), List.of()),
                        products.getOrDefault(group.id(), List.of())
                ))
                .toList();
    }

    @PostMapping("/addon-groups")
    @PreAuthorize("hasAnyRole('OWNER', 'MANAGER')")
    @Transactional
    public AddonGroupResponse createAddonGroup(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody CreateAddonGroupRequest request
    ) {
        UUID organizationId = TenantContext.organizationId(jwt);
        requireLocation(organizationId, request.locationId());
        validateSelection(request.required(), request.minSelect(), request.maxSelect());
        UUID id = UUID.randomUUID();
        jdbc.sql("""
                INSERT INTO addon_groups (
                    id, organization_id, location_id, name, required, min_select, max_select, sort_order
                ) VALUES (
                    :id, :organizationId, :locationId, :name, :required, :minSelect, :maxSelect, :sortOrder
                )
                """)
                .param("id", id)
                .param("organizationId", organizationId)
                .param("locationId", request.locationId())
                .param("name", request.name().trim())
                .param("required", request.required())
                .param("minSelect", request.minSelect())
                .param("maxSelect", request.maxSelect())
                .param("sortOrder", request.sortOrder())
                .update();
        saveAddonOptions(organizationId, id, request.options());
        linkProducts(id, request.productIds());
        audit.record(jwt, "ADDON_GROUP_CREATED", "addon_group", id, Map.of("name", request.name().trim()));
        return findAddonGroup(organizationId, id);
    }

    private void validateSelection(boolean required, int minSelect, int maxSelect) {
        int min = required ? Math.max(1, minSelect) : Math.max(0, minSelect);
        if (maxSelect < Math.max(min, 1) || maxSelect > 99) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "El rango de selección no es válido");
        }
    }

    private void saveAddonOptions(UUID organizationId, UUID groupId, List<AddonOptionInput> options) {
        int order = 0;
        for (AddonOptionInput option : options) {
            if (option.name() == null || option.name().isBlank()) {
                continue;
            }
            jdbc.sql("""
                    INSERT INTO addon_options (
                        id, organization_id, group_id, name, price, available, sort_order
                    ) VALUES (
                        :id, :organizationId, :groupId, :name, :price, 1, :sortOrder
                    )
                    """)
                    .param("id", UUID.randomUUID())
                    .param("organizationId", organizationId)
                    .param("groupId", groupId)
                    .param("name", option.name().trim())
                    .param("price", option.price() == null ? BigDecimal.ZERO : option.price())
                    .param("sortOrder", order++)
                    .update();
        }
    }

    private void linkProducts(UUID groupId, List<UUID> productIds) {
        if (productIds == null) {
            return;
        }
        for (UUID productId : productIds) {
            jdbc.sql("""
                    INSERT INTO product_addon_groups (product_id, group_id)
                    VALUES (:productId, :groupId)
                    """)
                    .param("productId", productId)
                    .param("groupId", groupId)
                    .update();
        }
    }

    private AddonGroupResponse findAddonGroup(UUID organizationId, UUID groupId) {
        AddonGroupResponse group = jdbc.sql("""
                SELECT id, location_id, name, required, min_select, max_select, sort_order, version
                FROM addon_groups
                WHERE id = :id AND organization_id = :organizationId AND active = 1
                """)
                .param("id", groupId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new AddonGroupResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("location_id", UUID.class),
                        rs.getString("name"),
                        rs.getBoolean("required"),
                        rs.getInt("min_select"),
                        rs.getInt("max_select"),
                        rs.getInt("sort_order"),
                        rs.getLong("version"),
                        List.of(),
                        List.of()
                ))
                .single();
        List<AddonOptionResponse> options = jdbc.sql("""
                SELECT id, group_id, name, price, available, sort_order
                FROM addon_options
                WHERE group_id = :groupId AND organization_id = :organizationId AND active = 1
                ORDER BY sort_order, name
                """)
                .param("groupId", groupId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new AddonOptionResponse(
                        rs.getObject("id", UUID.class),
                        rs.getObject("group_id", UUID.class),
                        rs.getString("name"),
                        rs.getBigDecimal("price"),
                        rs.getBoolean("available"),
                        rs.getInt("sort_order")
                ))
                .list();
        List<UUID> productIds = jdbc.sql("""
                SELECT product_id
                FROM product_addon_groups
                WHERE group_id = :groupId
                """)
                .param("groupId", groupId)
                .query(UUID.class)
                .list();
        return new AddonGroupResponse(
                group.id(), group.locationId(), group.name(), group.required(),
                group.minSelect(), group.maxSelect(), group.sortOrder(), group.version(),
                options, productIds
        );
    }

    private void requireLocation(UUID organizationId, UUID locationId) {
        int count = jdbc.sql("""
                SELECT COUNT(*) FROM locations
                WHERE id = :locationId AND organization_id = :organizationId AND active = 1
                """)
                .param("locationId", locationId)
                .param("organizationId", organizationId)
                .query(Integer.class)
                .single();
        if (count == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Local no encontrado");
        }
    }

    private String requireCategory(UUID organizationId, UUID locationId, UUID categoryId) {
        return jdbc.sql("""
                SELECT name FROM menu_categories
                WHERE id = :categoryId
                  AND organization_id = :organizationId
                  AND location_id = :locationId
                  AND active = 1
                """)
                .param("categoryId", categoryId)
                .param("organizationId", organizationId)
                .param("locationId", locationId)
                .query(String.class)
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Categoría no encontrada"));
    }

    private ProductResponse findProduct(UUID organizationId, UUID productId) {
        return jdbc.sql("""
                SELECT
                    p.id, p.location_id, p.category_id, c.name AS category_name,
                    p.name, p.sku, p.description, p.price, p.tax_rate,
                    p.available, p.prep_station, p.version
                FROM products p
                INNER JOIN menu_categories c ON c.id = p.category_id
                WHERE p.id = :id AND p.organization_id = :organizationId
                """)
                .param("id", productId)
                .param("organizationId", organizationId)
                .query(this::mapProduct)
                .single();
    }

    private ProductResponse mapProduct(ResultSet rs, int rowNum) throws SQLException {
        return new ProductResponse(
                rs.getObject("id", UUID.class),
                rs.getObject("location_id", UUID.class),
                rs.getObject("category_id", UUID.class),
                rs.getString("category_name"),
                rs.getString("name"),
                rs.getString("sku"),
                rs.getString("description"),
                rs.getBigDecimal("price"),
                rs.getBigDecimal("tax_rate"),
                rs.getBoolean("available"),
                rs.getString("prep_station"),
                rs.getLong("version")
        );
    }

    private String inferPrepStation(String categoryName, String productName) {
        String label = (categoryName + " " + productName).toLowerCase(java.util.Locale.ROOT);
        return label.contains("bebida") ? "BAR" : "KITCHEN";
    }

    private String normalizeStation(String station) {
        if (station == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Estación no válida");
        }
        String normalized = station.trim().toUpperCase(java.util.Locale.ROOT);
        if (!normalized.equals("KITCHEN") && !normalized.equals("BAR")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Estación no válida");
        }
        return normalized;
    }

    private String normalizeCode(String value) {
        return value.trim().toUpperCase(java.util.Locale.ROOT);
    }

    public record CreateCategoryRequest(
            @NotNull UUID locationId,
            @NotBlank @Size(max = 100) String name,
            @NotBlank @Size(max = 40) String code,
            @Min(0) int sortOrder
    ) {
    }

    public record CreateProductRequest(
            @NotNull UUID locationId,
            @NotNull UUID categoryId,
            @NotBlank @Size(max = 160) String name,
            @NotBlank @Size(max = 64) String sku,
            @Size(max = 500) String description,
            @NotNull @DecimalMin("0.00") BigDecimal price,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal taxRate
    ) {
    }

    public record UpdateProductRequest(
            @NotNull UUID productId,
            @NotNull UUID categoryId,
            @NotBlank @Size(max = 160) String name,
            @NotBlank @Size(max = 64) String sku,
            @Size(max = 500) String description,
            @NotNull @DecimalMin("0.00") BigDecimal price,
            @NotNull @DecimalMin("0.00") @DecimalMax("100.00") BigDecimal taxRate,
            @Min(0) long expectedVersion
    ) {
    }

    public record ChangeAvailabilityRequest(
            @NotNull UUID productId,
            boolean available,
            @Min(0) long expectedVersion
    ) {
    }

    public record PrepStationAssignment(
            @NotNull UUID productId,
            @NotBlank @Size(max = 16) String station
    ) {
    }

    public record UpdatePrepStationsRequest(
            @NotNull UUID locationId,
            @NotEmpty List<PrepStationAssignment> assignments
    ) {
    }

    public record CategoryResponse(UUID id, UUID locationId, String name, String code, int sortOrder) {
    }

    public record CreateAddonGroupRequest(
            @NotNull UUID locationId,
            @NotBlank @Size(max = 100) String name,
            boolean required,
            @Min(0) int minSelect,
            @Min(1) int maxSelect,
            @Min(0) int sortOrder,
            List<AddonOptionInput> options,
            List<UUID> productIds
    ) {
    }

    public record AddonOptionInput(
            @NotBlank @Size(max = 160) String name,
            @DecimalMin("0.00") BigDecimal price
    ) {
    }

    public record AddonOptionResponse(
            UUID id,
            UUID groupId,
            String name,
            BigDecimal price,
            boolean available,
            int sortOrder
    ) {
    }

    public record AddonGroupResponse(
            UUID id,
            UUID locationId,
            String name,
            boolean required,
            int minSelect,
            int maxSelect,
            int sortOrder,
            long version,
            List<AddonOptionResponse> options,
            List<UUID> productIds
    ) {
    }

    public record ProductResponse(
            UUID id,
            UUID locationId,
            UUID categoryId,
            String categoryName,
            String name,
            String sku,
            String description,
            BigDecimal price,
            BigDecimal taxRate,
            boolean available,
            String prepStation,
            long version
    ) {
    }
}
