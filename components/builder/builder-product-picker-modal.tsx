"use client";

import { useMemo, useState } from "react";
import type { BuilderProductRecord } from "@/lib/builder-template";
import { normalizeBuilderAssetUrl } from "@/lib/builder-template";

type BuilderProductPickerModalProps = {
  products: BuilderProductRecord[];
  selectedProductId?: string;
  onSelect: (productId: string) => void;
  onClose: () => void;
};

function productMatchesSearch(product: BuilderProductRecord, query: string) {
  if (!query) {
    return true;
  }

  const haystack = [product.name, product.productUrl].join(" ").toLowerCase();
  return haystack.includes(query);
}

export function BuilderProductPickerModal({
  products,
  selectedProductId,
  onSelect,
  onClose
}: BuilderProductPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return products.filter((product) => productMatchesSearch(product, query));
  }, [products, searchQuery]);

  return (
    <div className="builder-gallery-overlay" onClick={onClose} role="presentation">
      <div
        className="builder-gallery-modal builder-product-picker-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Shop products"
      >
        <div className="builder-gallery-header">
          <div>
            <div className="panel-label">Shop</div>
            <h3>Choose a product</h3>
            <p className="builder-module-editor-copy">
              Select a merch product from your shop. You can still edit fields after choosing.
            </p>
          </div>
          <button className="secondary-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
        <label className="field builder-product-picker-search">
          <span>Search</span>
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Filter by name or URL"
            autoFocus
          />
        </label>
        <div className="builder-gallery-body">
          <div className="builder-gallery-grid builder-product-picker-grid">
            {filteredProducts.map((product) => {
              const imageUrl = normalizeBuilderAssetUrl(product.imageUrl);
              const isSelected = product.id === selectedProductId;

              return (
                <button
                  className={`builder-gallery-card builder-product-picker-card${isSelected ? " is-selected" : ""}`}
                  key={product.id}
                  onClick={() => onSelect(product.id)}
                  type="button"
                >
                  <div className="builder-gallery-thumb">
                    {imageUrl ? (
                      <img alt={product.name} className="builder-product-picker-image" src={imageUrl} />
                    ) : (
                      <span className="builder-module-preview-placeholder">No image</span>
                    )}
                  </div>
                  <span>{product.name}</span>
                  <small className="gallery-meta">{product.productUrl || "No URL"}</small>
                </button>
              );
            })}
            {filteredProducts.length === 0 ? (
              <div className="builder-gallery-empty">
                {products.length === 0
                  ? "No merch products yet. Add products in Admin → Shop, then return here."
                  : "No products match your search."}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
