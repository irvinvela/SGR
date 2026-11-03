"use client";

import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  AddonGroup,
  CurrentUser,
  MenuCategory,
  Product,
  changeProductAvailability,
  createAddonGroup,
  createCategory,
  createProduct,
  listAddonGroups,
  listCategories,
  listProducts,
  updateProduct,
} from "@/lib/api";
import { SearchField } from "@/components/SearchField";
import { SystemSelect } from "@/components/SystemSelect";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

type CatalogTab = "products" | "categories" | "addons";
type CatalogMode = "service" | "edit";
type AvailabilityFilter = "all" | "active" | "unavailable";

export default function CatalogView() {
  const { user, locationId } = useAppNavigation();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [addonGroups, setAddonGroups] = useState<AddonGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [tab, setTab] = useState<CatalogTab>("products");
  const [mode, setMode] = useState<CatalogMode>("service");
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [categoryId, setCategoryId] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedAddonId, setSelectedAddonId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationModal, setCreationModal] = useState<"category" | "product" | "addon" | null>(null);
  const [addonOptions, setAddonOptions] = useState([{ name: "", price: "0" }, { name: "", price: "0" }]);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  useEffect(() => {
    setSearchQuery("");
    setCategoryId("all");
    setSelectedProductId("");
    setSelectedCategoryId("");
    setSelectedAddonId("");
  }, [locationId]);

  useEffect(() => {
    if (!locationId) return;
    Promise.all([listCategories(locationId), listProducts(locationId), listAddonGroups(locationId)])
      .then(([categoryResult, productResult, addonResult]) => {
        setCategories(categoryResult);
        setProducts(productResult);
        setAddonGroups(addonResult);
        setCategoryId((current) => (
          current === "all" || categoryResult.some((category) => category.id === current) ? current : "all"
        ));
        setError("");
      })
      .catch((cause) => setError(cause.message));
  }, [locationId]);

  useEffect(() => {
    if (!creationModal && !editingProduct) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        setCreationModal(null);
        setEditingProduct(null);
      }
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [creationModal, editingProduct, busy]);

  function openCreationModal(modal: "category" | "product" | "addon") {
    setError("");
    if (modal === "addon") setAddonOptions([{ name: "", price: "0" }, { name: "", price: "0" }]);
    setCreationModal(modal);
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const category = await createCategory({
        locationId,
        name: String(form.get("name")),
        code: String(form.get("code")),
        sortOrder: categories.length,
      });
      setCategories((current) => [...current, category]);
      formElement.reset();
      setCreationModal(null);
      setSelectedCategoryId(category.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la categoría");
    } finally {
      setBusy(false);
    }
  }

  async function addProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    try {
      const product = await createProduct({
        locationId,
        categoryId: String(form.get("categoryId")),
        name: String(form.get("name")),
        sku: String(form.get("sku")),
        description: String(form.get("description")),
        price: Number(form.get("price")),
        taxRate: Number(form.get("taxRate")),
      });
      setProducts((current) => [...current, product]);
      formElement.reset();
      setCreationModal(null);
      setTab("products");
      setSelectedProductId(product.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el producto");
    } finally {
      setBusy(false);
    }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingProduct) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const updated = await updateProduct({
        productId: editingProduct.id,
        categoryId: String(form.get("categoryId")),
        name: String(form.get("name")),
        sku: String(form.get("sku")),
        description: String(form.get("description")),
        price: Number(form.get("price")),
        taxRate: Number(form.get("taxRate")),
        expectedVersion: editingProduct.version,
      });
      setProducts((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingProduct(null);
      setSelectedProductId(updated.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el producto");
      if (locationId) setProducts(await listProducts(locationId));
    } finally {
      setBusy(false);
    }
  }

  async function addAddonGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const required = form.get("required") === "on";
    const options = addonOptions
      .map((option) => ({ name: option.name.trim(), price: Number(option.price || 0) }))
      .filter((option) => option.name);
    if (options.length === 0) {
      setError("Añade al menos una opción al grupo.");
      return;
    }
    setBusy(true);
    try {
      const group = await createAddonGroup({
        locationId,
        name: String(form.get("name")),
        required,
        minSelect: required ? Math.max(1, Number(form.get("minSelect") || 1)) : Number(form.get("minSelect") || 0),
        maxSelect: Number(form.get("maxSelect") || 1),
        sortOrder: addonGroups.length,
        options,
        productIds: form.getAll("productIds").map(String),
      });
      setAddonGroups((current) => [...current, group]);
      formElement.reset();
      setCreationModal(null);
      setTab("addons");
      setSelectedAddonId(group.id);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el grupo");
    } finally {
      setBusy(false);
    }
  }

  async function toggleAvailability(product: Product) {
    setBusy(true);
    try {
      const updated = await changeProductAvailability({
        productId: product.id,
        available: !product.available,
        expectedVersion: product.version,
      });
      setProducts((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el producto");
      if (locationId) setProducts(await listProducts(locationId));
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(() => ({
    all: products.length,
    active: products.filter((product) => product.available).length,
    unavailable: products.filter((product) => !product.available).length,
  }), [products]);

  const visibleProducts = products.filter((product) => {
    if (availability === "active" && !product.available) return false;
    if (availability === "unavailable" && product.available) return false;
    if (categoryId !== "all" && product.categoryId !== categoryId) return false;
    const query = normalizeSearch(searchQuery);
    if (!query) return true;
    return normalizeSearch([
      product.name,
      product.sku,
      product.categoryName,
      product.description ?? "",
    ].join(" ")).includes(query);
  });

  const visibleCategories = categories.filter((category) => {
    const query = normalizeSearch(searchQuery);
    if (!query) return true;
    return normalizeSearch(`${category.name} ${category.code}`).includes(query);
  });

  const visibleAddonGroups = addonGroups.filter((group) => {
    const query = normalizeSearch(searchQuery);
    if (!query) return true;
    return normalizeSearch(`${group.name} ${group.options.map((option) => option.name).join(" ")}`).includes(query);
  });

  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null;
  const selectedAddon = addonGroups.find((group) => group.id === selectedAddonId) ?? null;
  const manage = canManage(user);

  return (
    <>
      {error && <p className="error" role="alert">{error}</p>}

      <div className="catalog-view">
      <div className="halls-controls">
        <div className="view-toggle" role="tablist" aria-label="Catálogo">
          <button type="button" className="service-chip" aria-pressed={tab === "products"} onClick={() => setTab("products")}>
            <ProductIcon />
            Productos <strong>{products.length}</strong>
          </button>
          <button type="button" className="service-chip" aria-pressed={tab === "categories"} onClick={() => setTab("categories")}>
            <CategoryIcon />
            Categorías <strong>{categories.length}</strong>
          </button>
          <button type="button" className="service-chip" aria-pressed={tab === "addons"} onClick={() => setTab("addons")}>
            <AddonIcon />
            Grupos de adicionales <strong>{addonGroups.length}</strong>
          </button>
        </div>
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Nombre, SKU o categoría"
          aria-controls="catalog-product-list"
        />
        {manage && (
          <div className="view-toggle" role="group" aria-label="Modo">
            <button type="button" className="service-chip" aria-pressed={mode === "service"} onClick={() => setMode("service")}>
              <ServiceIcon />
              Servicio
            </button>
            <button type="button" className="service-chip" aria-pressed={mode === "edit"} onClick={() => setMode("edit")}>
              <EditIcon />
              Edición
            </button>
          </div>
        )}
        {mode === "edit" && manage && (
          <div className="catalog-creation-actions">
            <button type="button" className="toolbar-action-button" onClick={() => openCreationModal("category")} disabled={!locationId}>
              <CategoryIcon />
              <span>Nueva categoría</span>
            </button>
            <button type="button" className="toolbar-action-button" onClick={() => openCreationModal("product")} disabled={!locationId}>
              <ProductIcon />
              <span>Nuevo producto</span>
            </button>
            <button type="button" className="toolbar-action-button" onClick={() => openCreationModal("addon")} disabled={!locationId}>
              <AddonIcon />
              <span>Nuevo grupo</span>
            </button>
          </div>
        )}
      </div>

      {tab === "products" && (
        <>
          <div className="service-filters" role="group" aria-label="Disponibilidad">
            <FilterChip pressed={availability === "all"} icon={<ProductIcon />} label="Todos" count={counts.all} onClick={() => setAvailability("all")} />
            <FilterChip pressed={availability === "active"} icon={<ActiveIcon />} label="Activos" count={counts.active} tone="ok" onClick={() => setAvailability("active")} />
            <FilterChip pressed={availability === "unavailable"} icon={<OffIcon />} label="No disponibles" count={counts.unavailable} onClick={() => setAvailability("unavailable")} />
          </div>
          <div className="service-filters" role="group" aria-label="Categoría">
            <FilterChip pressed={categoryId === "all"} icon={<CategoryIcon />} label="Todas las categorías" count={products.length} onClick={() => setCategoryId("all")} />
            {categories.map((category) => (
              <FilterChip
                key={category.id}
                pressed={categoryId === category.id}
                icon={<CategoryIcon />}
                label={category.name}
                count={products.filter((product) => product.categoryId === category.id).length}
                onClick={() => setCategoryId(category.id)}
              />
            ))}
          </div>
        </>
      )}

      <div className="halls-board">
        <div className="halls-main">
          {tab === "products" && (
            <section id="catalog-product-list" className="catalog-list" aria-label="Productos">
              <header className="catalog-list-head">
                <span>Producto</span>
                <span>Precio</span>
                <span>Estado</span>
                <span />
              </header>
              {visibleProducts.map((product) => (
                <article
                  key={product.id}
                  className={`catalog-row ${product.available ? "" : "unavailable"} ${selectedProductId === product.id ? "selected" : ""}`}
                  onClick={() => setSelectedProductId(product.id)}
                >
                  <div className="catalog-row-product">
                    <span className="catalog-avatar" aria-hidden="true">{initials(product.name)}</span>
                    <div>
                      <strong>{product.name}</strong>
                      <small>{product.sku || "Sin SKU"}</small>
                    </div>
                  </div>
                  <div className="product-price">
                    <strong>{money.format(product.price)}</strong>
                    <small>IVA {product.taxRate}%</small>
                  </div>
                  <span className={`service-pill ${product.available ? "status-free" : "status-out_of_service"}`}>
                    {product.available ? <ActiveIcon /> : <OffIcon />}
                    {product.available ? "Activo" : "No disponible"}
                  </span>
                  {manage ? (
                    <button
                      type="button"
                      className="inline-link-button"
                      disabled={busy}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleAvailability(product);
                      }}
                    >
                      {product.available ? <><OffIcon /> Marcar no disponible</> : <><ActiveIcon /> Restaurar</>}
                    </button>
                  ) : (
                    <span />
                  )}
                </article>
              ))}
            </section>
          )}
          {tab === "categories" && (
            <section className="catalog-list" aria-label="Categorías">
              {visibleCategories.map((category) => {
                const count = products.filter((product) => product.categoryId === category.id).length;
                return (
                  <article
                    key={category.id}
                    className={`catalog-row catalog-row-category ${selectedCategoryId === category.id ? "selected" : ""}`}
                    onClick={() => setSelectedCategoryId(category.id)}
                  >
                    <div className="catalog-row-product">
                      <span className="catalog-avatar" aria-hidden="true">{initials(category.name)}</span>
                      <div>
                        <strong>{category.name}</strong>
                        <small>{category.code}</small>
                      </div>
                    </div>
                    <span>{count} {count === 1 ? "producto" : "productos"}</span>
                  </article>
                );
              })}
            </section>
          )}
          {tab === "products" && locationId && products.length === 0 && (
            <p className="empty-state">Todavía no hay productos en este local.</p>
          )}
          {tab === "products" && products.length > 0 && visibleProducts.length === 0 && (
            <p className="empty-state">No se encontraron productos para estos filtros.</p>
          )}
          {tab === "addons" && (
            <section className="catalog-list" aria-label="Grupos de adicionales">
              {visibleAddonGroups.map((group) => (
                <article
                  key={group.id}
                  className={`catalog-row catalog-row-category ${selectedAddonId === group.id ? "selected" : ""}`}
                  onClick={() => setSelectedAddonId(group.id)}
                >
                  <div className="catalog-row-product">
                    <span className="catalog-avatar" aria-hidden="true"><AddonIcon /></span>
                    <div>
                      <strong>{group.name}</strong>
                      <small>
                        {group.required ? "Obligatorio" : "Opcional"}
                        {" · "}
                        {group.minSelect}-{group.maxSelect} opciones
                      </small>
                    </div>
                  </div>
                  <span>{group.options.length} {group.options.length === 1 ? "opción" : "opciones"}</span>
                </article>
              ))}
            </section>
          )}
          {tab === "categories" && locationId && categories.length === 0 && (
            <p className="empty-state">Todavía no hay categorías en este local.</p>
          )}
          {tab === "addons" && locationId && addonGroups.length === 0 && (
            <p className="empty-state">Todavía no hay grupos de adicionales en este local.</p>
          )}
          {tab === "addons" && addonGroups.length > 0 && visibleAddonGroups.length === 0 && (
            <p className="empty-state">No se encontraron grupos para esta búsqueda.</p>
          )}
        </div>

        <aside className="halls-inspector" aria-live="polite">
          {tab === "products" && !selectedProduct && (
            <div className="halls-inspector-empty">
              <ProductIcon />
              <h2>Elige un producto</h2>
              <p>Toca un producto para ver su ficha y cambiar su disponibilidad.</p>
            </div>
          )}
          {tab === "products" && selectedProduct && (
            <>
              <span className="catalog-avatar catalog-avatar-lg" aria-hidden="true">{initials(selectedProduct.name)}</span>
              <span className={`service-pill ${selectedProduct.available ? "status-free" : "status-out_of_service"}`}>
                {selectedProduct.available ? <ActiveIcon /> : <OffIcon />}
                {selectedProduct.available ? "Activo" : "No disponible"}
              </span>
              <h2>{selectedProduct.name}</h2>
              <p className="table-card-meta">
                {selectedProduct.categoryName} · {selectedProduct.sku || "Sin SKU"}
              </p>
              {selectedProduct.description && <p>{selectedProduct.description}</p>}
              <dl className="halls-inspector-stats">
                <div>
                  <dt>Precio</dt>
                  <dd>{money.format(selectedProduct.price)}</dd>
                </div>
                <div>
                  <dt>IVA</dt>
                  <dd>{selectedProduct.taxRate}%</dd>
                </div>
              </dl>
              {manage && (
                <div className="table-card-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy}
                    onClick={() => toggleAvailability(selectedProduct)}
                  >
                    {selectedProduct.available ? <><OffIcon /> Marcar no disponible</> : <><ActiveIcon /> Restaurar</>}
                  </button>
                  {mode === "edit" && (
                    <button
                      type="button"
                      className="primary-button"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setEditingProduct(selectedProduct);
                      }}
                    >
                      <EditIcon />
                      Editar
                    </button>
                  )}
                </div>
              )}
            </>
          )}
          {tab === "categories" && !selectedCategory && (
            <div className="halls-inspector-empty">
              <CategoryIcon />
              <h2>Elige una categoría</h2>
              <p>Toca una categoría para ver cuántos productos tiene.</p>
            </div>
          )}
          {tab === "addons" && !selectedAddon && (
            <div className="halls-inspector-empty">
              <AddonIcon />
              <h2>Elige un grupo</h2>
              <p>Toca un grupo para ver sus opciones y a qué productos se aplica.</p>
            </div>
          )}
          {tab === "addons" && selectedAddon && (
            <>
              <span className={`service-pill ${selectedAddon.required ? "status-occupied" : "status-free"}`}>
                {selectedAddon.required ? "Obligatorio" : "Opcional"}
              </span>
              <h2>{selectedAddon.name}</h2>
              <p className="table-card-meta">
                Elige de {selectedAddon.minSelect} a {selectedAddon.maxSelect} opciones.
              </p>
              <ul className="catalog-addon-options">
                {selectedAddon.options.map((option) => (
                  <li key={option.id}>
                    <span>{option.name}</span>
                    <strong>{option.price > 0 ? `+ ${money.format(option.price)}` : "Sin cargo"}</strong>
                  </li>
                ))}
              </ul>
              <p>
                {selectedAddon.productIds.length === 0
                  ? "No está asignado a ningún producto todavía."
                  : `Asignado a ${selectedAddon.productIds.length} ${selectedAddon.productIds.length === 1 ? "producto" : "productos"}.`}
              </p>
            </>
          )}
          {tab === "categories" && selectedCategory && (
            <>
              <h2>{selectedCategory.name}</h2>
              <p className="table-card-meta">{selectedCategory.code}</p>
              <p>
                {products.filter((product) => product.categoryId === selectedCategory.id).length} productos en esta categoría.
              </p>
              {mode === "edit" && manage && (
                <div className="table-card-actions">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy}
                    onClick={() => openCreationModal("product")}
                  >
                    <ProductIcon />
                    Nuevo producto
                  </button>
                </div>
              )}
            </>
          )}
        </aside>
      </div>
      </div>

      {creationModal && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setCreationModal(null);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-creation-modal-title">
            <header>
              <div className="creation-modal-title">
                <span>{creationModal === "category" ? <CategoryIcon /> : creationModal === "addon" ? <AddonIcon /> : <ProductIcon />}</span>
                <div>
                  <p>Catálogo</p>
                  <h2 id="catalog-creation-modal-title">
                    {creationModal === "category" ? "Nueva categoría" : creationModal === "addon" ? "Nuevo grupo de adicionales" : "Nuevo producto"}
                  </h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setCreationModal(null)} disabled={busy}>
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            {creationModal === "addon" ? (
              <form className="creation-modal-form" onSubmit={addAddonGroup}>
                <label>
                  Nombre del grupo
                  <input name="name" maxLength={100} placeholder="Ej. Punto de cocción" autoFocus required />
                </label>
                <label className="halls-details">
                  <input type="checkbox" name="required" />
                  Obligatorio al pedir
                </label>
                <div className="split-fields">
                  <label>
                    Mínimo
                    <input name="minSelect" type="number" min={0} max={99} defaultValue={0} />
                  </label>
                  <label>
                    Máximo
                    <input name="maxSelect" type="number" min={1} max={99} defaultValue={1} required />
                  </label>
                </div>
                <fieldset className="catalog-addon-fields">
                  <legend>Opciones</legend>
                  {addonOptions.map((option, index) => (
                    <div className="split-fields" key={index}>
                      <label>
                        Nombre
                        <input
                          value={option.name}
                          onChange={(event) => setAddonOptions((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, name: event.target.value } : item
                          )))}
                          maxLength={160}
                          placeholder={index === 0 ? "Ej. Término medio" : "Opción"}
                        />
                      </label>
                      <label>
                        Precio extra
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={option.price}
                          onChange={(event) => setAddonOptions((current) => current.map((item, itemIndex) => (
                            itemIndex === index ? { ...item, price: event.target.value } : item
                          )))}
                        />
                      </label>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="inline-link-button"
                    onClick={() => setAddonOptions((current) => [...current, { name: "", price: "0" }])}
                  >
                    Añadir opción
                  </button>
                </fieldset>
                {products.length > 0 && (
                  <fieldset className="catalog-addon-fields">
                    <legend>Productos</legend>
                    {products.map((product) => (
                      <label className="halls-details" key={product.id}>
                        <input type="checkbox" name="productIds" value={product.id} />
                        {product.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                <div className="creation-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setCreationModal(null)} disabled={busy}>
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={busy || !locationId}>
                    {busy ? "Creando…" : "Crear grupo"}
                  </button>
                </div>
              </form>
            ) : creationModal === "category" ? (
              <form className="creation-modal-form" onSubmit={addCategory}>
                <label>
                  Nombre de la categoría
                  <input name="name" maxLength={100} placeholder="Ej. Bebidas" autoFocus required />
                </label>
                <label>
                  Código
                  <input name="code" maxLength={40} placeholder="Ej. BEBIDAS" required />
                </label>
                <div className="creation-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setCreationModal(null)} disabled={busy}>
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={busy || !locationId}>
                    {busy ? "Creando…" : "Crear categoría"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="creation-modal-form" onSubmit={addProduct}>
                <label>
                  Categoría
                  <SystemSelect
                    className="fill"
                    name="categoryId"
                    defaultValue={selectedCategoryId || ""}
                    autoFocus
                    required
                    options={[
                      { value: "", label: "Seleccionar categoría" },
                      ...categories.map((category) => ({
                        value: category.id,
                        label: category.name,
                      })),
                    ]}
                  />
                </label>
                <label>
                  Nombre del producto
                  <input name="name" maxLength={160} placeholder="Ej. Café americano" required />
                </label>
                <label>
                  SKU
                  <input name="sku" maxLength={64} placeholder="Ej. CAF-AMER" required />
                </label>
                <label>
                  Descripción
                  <input name="description" maxLength={500} placeholder="Descripción opcional" />
                </label>
                <div className="split-fields">
                  <label>
                    Precio
                    <input name="price" type="number" min="0" step="0.01" required />
                  </label>
                  <label>
                    IVA %
                    <input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue="10" required />
                  </label>
                </div>
                {categories.length === 0 && (
                  <p className="creation-modal-hint">
                    Primero debes crear una categoría para poder añadir un producto.
                  </p>
                )}
                <div className="creation-modal-actions">
                  <button type="button" className="secondary-button" onClick={() => setCreationModal(null)} disabled={busy}>
                    Cancelar
                  </button>
                  <button className="primary-button" disabled={busy || categories.length === 0}>
                    {busy ? "Creando…" : "Crear producto"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      )}
      {editingProduct && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setEditingProduct(null);
          }}
        >
          <section className="creation-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-edit-modal-title">
            <header>
              <div className="creation-modal-title">
                <span><ProductIcon /></span>
                <div>
                  <p>Catálogo</p>
                  <h2 id="catalog-edit-modal-title">Editar producto</h2>
                </div>
              </div>
              <button type="button" className="creation-modal-close" aria-label="Cerrar" onClick={() => setEditingProduct(null)} disabled={busy}>
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <form className="creation-modal-form" onSubmit={saveProduct}>
              <label>
                Categoría
                <SystemSelect
                  className="fill"
                  name="categoryId"
                  defaultValue={editingProduct.categoryId}
                  autoFocus
                  required
                  options={categories.map((category) => ({
                    value: category.id,
                    label: category.name,
                  }))}
                />
              </label>
              <label>
                Nombre del producto
                <input name="name" maxLength={160} defaultValue={editingProduct.name} required />
              </label>
              <label>
                SKU
                <input name="sku" maxLength={64} defaultValue={editingProduct.sku} required />
              </label>
              <label>
                Descripción
                <input name="description" maxLength={500} defaultValue={editingProduct.description ?? ""} />
              </label>
              <div className="split-fields">
                <label>
                  Precio
                  <input name="price" type="number" min="0" step="0.01" defaultValue={editingProduct.price} required />
                </label>
                <label>
                  IVA %
                  <input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue={editingProduct.taxRate} required />
                </label>
              </div>
              <div className="creation-modal-actions">
                <button type="button" className="secondary-button" onClick={() => setEditingProduct(null)} disabled={busy}>
                  Cancelar
                </button>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}

function FilterChip({
  icon,
  label,
  count,
  pressed,
  tone,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  count: number;
  pressed: boolean;
  tone?: "ok" | "warn" | "bill" | "reserve";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`service-chip ${tone ? `tone-${tone}` : ""}`}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <span>{icon}{label}</span>
      <strong>{count}</strong>
    </button>
  );
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function canManage(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}

function AddonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <circle cx="12" cy="16" r="3" />
    </svg>
  );
}

function CategoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h7v5H4zM13 6h7v5h-7zM4 13h7v5H4zM13 13h7v5h-7z" />
    </svg>
  );
}

function ProductIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8.5 12 4l7 4.5v7L12 20l-7-4.5z" />
      <path d="m5 8.5 7 4.5 7-4.5M12 13v7" />
    </svg>
  );
}

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 11h14v2.5a7 7 0 0 1-14 0Z" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8Z" />
      <path d="M12.8 7l4.2 4.2" />
    </svg>
  );
}

function ActiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="m8.5 12.2 2.3 2.3 4.7-5" />
    </svg>
  );
}

function OffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="7.5" />
      <path d="M8 8l8 8" />
    </svg>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}
