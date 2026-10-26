"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAppNavigation } from "@/components/AppShell";
import {
  CurrentUser,
  Location,
  MenuCategory,
  Product,
  changeProductAvailability,
  createCategory,
  createProduct,
  listCategories,
  listLocations,
  listProducts,
  updateProduct,
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function CatalogView() {
  const { user } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [creationModal, setCreationModal] = useState<"category" | "product" | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  useEffect(() => {
    listLocations()
      .then((result) => {
        setLocations(result);
        if (result[0]) setLocationId(result[0].id);
      })
      .catch((cause) => setError(cause.message));
  }, []);

  useEffect(() => {
    if (!locationId) return;
    Promise.all([listCategories(locationId), listProducts(locationId)])
      .then(([categoryResult, productResult]) => {
        setCategories(categoryResult);
        setProducts(productResult);
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

  function openCreationModal(modal: "category" | "product") {
    setError("");
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
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el producto");
      if (locationId) setProducts(await listProducts(locationId));
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

  const normalizedQuery = normalizeSearch(searchQuery);
  const visibleProducts = normalizedQuery
    ? products.filter((product) => normalizeSearch([
        product.name,
        product.sku,
        product.categoryName,
        product.description ?? "",
      ].join(" ")).includes(normalizedQuery))
    : products;

  return (
    <>
      <div className="toolbar catalog-toolbar">
        <label>
          Local
          <select
            value={locationId}
            onChange={(event) => {
              setLocationId(event.target.value);
              setSearchQuery("");
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
        <label className="catalog-search">
          Buscar producto
          <span className="catalog-search-field">
            <SearchIcon />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Nombre, SKU o categoría"
              aria-controls="catalog-product-list"
            />
          </span>
        </label>
        {canManage(user) && (
          <div className="catalog-creation-actions">
            <button
              type="button"
              className="toolbar-action-button"
              onClick={() => openCreationModal("category")}
              disabled={!locationId}
            >
              <CategoryIcon />
              <span>Nueva categoría</span>
            </button>
            <button
              type="button"
              className="toolbar-action-button"
              onClick={() => openCreationModal("product")}
              disabled={!locationId}
            >
              <ProductIcon />
              <span>Nuevo producto</span>
            </button>
          </div>
        )}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {normalizedQuery && (
        <p className="catalog-search-summary" role="status">
          {visibleProducts.length} {visibleProducts.length === 1 ? "resultado" : "resultados"}
        </p>
      )}
      <section
        id="catalog-product-list"
        className="product-list"
        aria-label="Productos"
        aria-live="polite"
      >
        {visibleProducts.map((product) => (
          <article className={product.available ? "product-row" : "product-row unavailable"} key={product.id}>
            <div>
              <small>{product.categoryName} · {product.sku}</small>
              <h2>{product.name}</h2>
              {product.description && <p>{product.description}</p>}
            </div>
            <div className="product-price">
              <strong>{money.format(product.price)}</strong>
              <small>IVA {product.taxRate}%</small>
            </div>
            {canManage(user) && (
              <div className="table-card-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => {
                    setError("");
                    setEditingProduct(product);
                  }}
                >
                  Editar
                </button>
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => toggleAvailability(product)}
                >
                  {product.available ? "Marcar no disponible" : "Restaurar"}
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
      {locationId && products.length === 0 && (
        <p className="empty-state">Todavía no hay productos en este local.</p>
      )}
      {products.length > 0 && normalizedQuery && visibleProducts.length === 0 && (
        <p className="empty-state">No se encontraron productos para “{searchQuery.trim()}”.</p>
      )}
      {creationModal && (
        <div
          className="creation-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setCreationModal(null);
          }}
        >
          <section
            className="creation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-creation-modal-title"
          >
            <header>
              <div className="creation-modal-title">
                <span>
                  {creationModal === "category" ? <CategoryIcon /> : <ProductIcon />}
                </span>
                <div>
                  <p>Catálogo</p>
                  <h2 id="catalog-creation-modal-title">
                    {creationModal === "category" ? "Nueva categoría" : "Nuevo producto"}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setCreationModal(null)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            {creationModal === "category" ? (
              <form className="creation-modal-form" onSubmit={addCategory}>
                <label>
                  Nombre de la categoría
                  <input
                    name="name"
                    maxLength={100}
                    placeholder="Ej. Bebidas"
                    autoFocus
                    required
                  />
                </label>
                <label>
                  Código
                  <input name="code" maxLength={40} placeholder="Ej. BEBIDAS" required />
                </label>
                <div className="creation-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCreationModal(null)}
                    disabled={busy}
                  >
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
                  <select name="categoryId" defaultValue="" autoFocus required>
                    <option value="">Seleccionar categoría</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
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
                    <input
                      name="taxRate"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      defaultValue="10"
                      required
                    />
                  </label>
                </div>
                {categories.length === 0 && (
                  <p className="creation-modal-hint">
                    Primero debes crear una categoría para poder añadir un producto.
                  </p>
                )}
                <div className="creation-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setCreationModal(null)}
                    disabled={busy}
                  >
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
          <section
            className="creation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="catalog-edit-modal-title"
          >
            <header>
              <div className="creation-modal-title">
                <span><ProductIcon /></span>
                <div>
                  <p>Catálogo</p>
                  <h2 id="catalog-edit-modal-title">Editar producto</h2>
                </div>
              </div>
              <button
                type="button"
                className="creation-modal-close"
                aria-label="Cerrar"
                onClick={() => setEditingProduct(null)}
                disabled={busy}
              >
                ×
              </button>
            </header>
            {error && <p className="error" role="alert">{error}</p>}
            <form className="creation-modal-form" onSubmit={saveProduct}>
              <label>
                Categoría
                <select name="categoryId" defaultValue={editingProduct.categoryId} autoFocus required>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
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
                  <input
                    name="taxRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={editingProduct.taxRate}
                    required
                  />
                </label>
              </div>
              <div className="creation-modal-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditingProduct(null)}
                  disabled={busy}
                >
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

function canManage(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
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

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15 15 4 4" />
    </svg>
  );
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
}
