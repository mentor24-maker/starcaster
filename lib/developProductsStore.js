'use strict';

const { sbQuery, tableConfig } = require('./supabase');
const { scopedListQuery, scopedIdQuery, scopedInsertRow, scopedPatchRow } = require('./projectScope');
const { rowToBuilderProduct } = require('./builder');
const { nextId } = require('../routes/http');

function table() {
  return tableConfig().developProducts;
}

function safeText(value, max = 5000) {
  return String(value || '').trim().slice(0, max);
}

function inputToRow(input) {
  return {
    id: safeText(input?.id, 120) || nextId('product'),
    name: safeText(input?.name, 255),
    product_type: safeText(input?.productType || input?.product_type, 80) || 'merch',
    product_url: safeText(input?.productUrl || input?.product_url, 2000),
    image_url: safeText(input?.imageUrl || input?.image_url, 2000),
  };
}

async function listProducts(limit = 1000, scope = null) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 5000));
  const query = await scopedListQuery(
    table(),
    `select=*&order=updated_at.desc,created_at.desc&limit=${safeLimit}`,
    scope
  );
  const res = await sbQuery({ method: 'GET', table: table(), query });
  if (!res.ok) return res;
  return {
    ok: true,
    status: 200,
    data: Array.isArray(res.data) ? res.data.map(rowToBuilderProduct) : [],
  };
}

async function createProduct(input, scope = null) {
  const row = await scopedInsertRow(table(), inputToRow(input), scope);
  const res = await sbQuery({
    method: 'POST',
    table: table(),
    query: 'select=*',
    headers: { Prefer: 'return=representation' },
    body: [row],
  });
  if (!res.ok) return res;
  const created = Array.isArray(res.data) ? res.data[0] : res.data;
  return { ok: true, status: 201, data: rowToBuilderProduct(created) };
}

async function updateProduct(id, input, scope = null) {
  const productId = safeText(id, 120);
  if (!productId) return { ok: false, status: 400, error: 'id is required' };
  const row = await scopedPatchRow(table(), inputToRow({ ...input, id: productId }), scope);
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(productId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'PATCH',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
    body: row,
  });
  if (!res.ok) return res;
  const updated = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!updated) return { ok: false, status: 404, error: 'Product not found' };
  return { ok: true, status: 200, data: rowToBuilderProduct(updated) };
}

async function deleteProduct(id, scope = null) {
  const productId = safeText(id, 120);
  if (!productId) return { ok: false, status: 400, error: 'id is required' };
  const query = await scopedIdQuery(table(), `id=eq.${encodeURIComponent(productId)}&select=*`, scope);
  const res = await sbQuery({
    method: 'DELETE',
    table: table(),
    query,
    headers: { Prefer: 'return=representation' },
  });
  if (!res.ok) return res;
  const removed = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!removed) return { ok: false, status: 404, error: 'Product not found' };
  return { ok: true, status: 200, data: rowToBuilderProduct(removed) };
}

module.exports = {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
