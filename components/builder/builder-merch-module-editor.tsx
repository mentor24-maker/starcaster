"use client";

import { useState } from "react";
import type { BuilderProductRecord, BuilderTemplateModule } from "@/lib/builder-template";
import { BuilderProductPickerModal } from "@/components/builder/builder-product-picker-modal";
import { BuilderImagePickerField } from "./builder-image-picker-field";
import { BuilderSettingRow } from "./builder-setting-row";

type MerchModuleEditorProps = {
  module: BuilderTemplateModule;
  products: BuilderProductRecord[];
  onUpdateModule: (updater: (current: BuilderTemplateModule) => BuilderTemplateModule) => void;
};

export function MerchModuleEditor({ module, products, onUpdateModule }: MerchModuleEditorProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const merchProducts = products.filter((product) => product.productType === "merch");
  const selectedProduct = merchProducts.find((product) => product.id === module.settings.productId);

  function updateSettings(updates: Record<string, string>) {
    onUpdateModule((current) => ({
      ...current,
      settings: { ...current.settings, ...updates }
    }));
  }

  function applyMerchProduct(productId: string) {
    const product = products.find((candidate) => candidate.id === productId);

    updateSettings({
      productId,
      productUrl: product?.productUrl ?? module.settings.productUrl ?? "",
      productName: product?.name ?? module.settings.productName ?? "",
      imageUrl: product?.imageUrl ?? module.settings.imageUrl ?? ""
    });
  }

  return (
    <>
      <div className="builder-merch-module-settings">
        <BuilderSettingRow fullWidth label="Saved Product">
          <div className="builder-merch-product-picker">
            <input
              placeholder="Choose From Shop"
              readOnly
              type="text"
              value={selectedProduct?.name ?? ""}
            />
            <button
              aria-label="Browse shop products"
              className="builder-icon-button builder-product-picker-button"
              onClick={() => setIsPickerOpen(true)}
              title="Browse Shop Products"
              type="button"
            >
              🛍
            </button>
          </div>
        </BuilderSettingRow>

        <BuilderSettingRow fullWidth label="Product URL">
          <input
            placeholder="https://www.redbubble.com/i/t-shirt/..."
            type="text"
            value={module.settings.productUrl ?? ""}
            onChange={(event) => updateSettings({ productUrl: event.target.value })}
          />
        </BuilderSettingRow>

        <BuilderSettingRow fullWidth label="Product Name">
          <input
            placeholder="Active T-Shirt"
            type="text"
            value={module.settings.productName ?? ""}
            onChange={(event) => updateSettings({ productName: event.target.value })}
          />
        </BuilderSettingRow>

        <BuilderSettingRow fullWidth label="Image URL">
          <BuilderImagePickerField
            placeholder="https://ih1.redbubble.net/..."
            value={module.settings.imageUrl ?? ""}
            onChange={(url) => updateSettings({ imageUrl: url })}
          />
        </BuilderSettingRow>

        <BuilderSettingRow fullWidth label="Button Label">
          <input
            placeholder="Buy on Redbubble"
            type="text"
            value={module.settings.buttonLabel ?? "Buy on Redbubble"}
            onChange={(event) => updateSettings({ buttonLabel: event.target.value })}
          />
        </BuilderSettingRow>
      </div>

      {isPickerOpen ? (
        <BuilderProductPickerModal
          products={merchProducts}
          selectedProductId={module.settings.productId}
          onClose={() => setIsPickerOpen(false)}
          onSelect={(productId) => {
            applyMerchProduct(productId);
            setIsPickerOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
