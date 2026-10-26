package com.semaialabs.sgr.catalog;

import com.semaialabs.sgr.audit.AuditService;
import com.semaialabs.sgr.tenant.TenantContext;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
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
                    p.available, p.version
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
                .query((rs, rowNum) -> new ProductResponse(
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
                        rs.getLong("version")
                ))
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
        jdbc.sql("""
                INSERT INTO products (
                    id, organization_id, location_id, category_id,
                    name, sku, description, price, tax_rate
                ) VALUES (
                    :id, :organizationId, :locationId, :categoryId,
                    :name, :sku, :description, :price, :taxRate
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
                .update();
        audit.record(jwt, "PRODUCT_CREATED", "product", id, Map.of("sku", sku));
        return new ProductResponse(
                id, request.locationId(), request.categoryId(), categoryName,
                request.name().trim(), sku, description, request.price(),
                request.taxRate(), true, 0
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
                    p.available, p.version
                FROM products p
                INNER JOIN menu_categories c ON c.id = p.category_id
                WHERE p.id = :id AND p.organization_id = :organizationId
                """)
                .param("id", productId)
                .param("organizationId", organizationId)
                .query((rs, rowNum) -> new ProductResponse(
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
                        rs.getLong("version")
                ))
                .single();
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

    public record CategoryResponse(UUID id, UUID locationId, String name, String code, int sortOrder) {
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
            long version
    ) {
    }
}
