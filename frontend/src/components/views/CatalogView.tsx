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
} from "@/lib/api";

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

export default function CatalogView() {
  const { user } = useAppNavigation();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el producto");
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

  return (
    <>
      <div className="toolbar">
        <label>
          Local
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>{location.name}</option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {canManage(user) && (
        <section className="forms-grid">
          <form className="form-card" onSubmit={addCategory}>
            <h2>Nueva categoría</h2>
            <label>Nombre<input name="name" maxLength={100} required /></label>
            <label>Código<input name="code" maxLength={40} required /></label>
            <button className="primary-button" disabled={busy || !locationId}>Crear categoría</button>
          </form>
          <form className="form-card" onSubmit={addProduct}>
            <h2>Nuevo producto</h2>
            <label>
              Categoría
              <select name="categoryId" required>
                <option value="">Seleccionar</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
            </label>
            <label>Nombre<input name="name" maxLength={160} required /></label>
            <label>SKU<input name="sku" maxLength={64} required /></label>
            <label>Descripción<input name="description" maxLength={500} /></label>
            <div className="split-fields">
              <label>Precio<input name="price" type="number" min="0" step="0.01" required /></label>
              <label>IVA %<input name="taxRate" type="number" min="0" max="100" step="0.01" defaultValue="10" required /></label>
            </div>
            <button className="primary-button" disabled={busy || categories.length === 0}>Crear producto</button>
          </form>
        </section>
      )}
      <section className="product-list" aria-label="Productos">
        {products.map((product) => (
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
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => toggleAvailability(product)}
              >
                {product.available ? "Marcar no disponible" : "Restaurar"}
              </button>
            )}
          </article>
        ))}
      </section>
      {locationId && products.length === 0 && (
        <p className="empty-state">Todavía no hay productos en este local.</p>
      )}
    </>
  );
}

function canManage(user: CurrentUser) {
  return user.role === "OWNER" || user.role === "MANAGER";
}
