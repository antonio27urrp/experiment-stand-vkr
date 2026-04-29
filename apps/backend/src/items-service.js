import { readDataset, replaceDataset } from "./storage.js";

const allowedSortFields = new Set(["id", "title", "category", "score", "createdAt", "updatedAt"]);

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function applyQuery(items, query) {
  const search = normalizeText(query.search);
  const category = normalizeText(query.category);
  const status = normalizeText(query.status);

  return items.filter((item) => {
    const matchesSearch =
      !search ||
      normalizeText(item.title).includes(search) ||
      normalizeText(item.description).includes(search) ||
      normalizeText(item.owner).includes(search);

    const matchesCategory = !category || normalizeText(item.category) === category;
    const matchesStatus = !status || normalizeText(item.status) === status;

    return matchesSearch && matchesCategory && matchesStatus;
  });
}

function applySort(items, sortBy = "id", sortOrder = "asc") {
  const field = allowedSortFields.has(sortBy) ? sortBy : "id";
  const direction = sortOrder === "desc" ? -1 : 1;

  return [...items].sort((a, b) => {
    if (a[field] < b[field]) return -1 * direction;
    if (a[field] > b[field]) return 1 * direction;
    return 0;
  });
}

function paginate(items, page = 1, pageSize = 20) {
  const normalizedPage = Math.max(Number(page) || 1, 1);
  const normalizedPageSize = Math.min(Math.max(Number(pageSize) || 20, 1), 10000);
  const start = (normalizedPage - 1) * normalizedPageSize;

  return {
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total: items.length,
    items: items.slice(start, start + normalizedPageSize)
  };
}

export async function listItems(query) {
  const items = await readDataset();
  const filtered = applyQuery(items, query);
  const sorted = applySort(filtered, query.sortBy, query.sortOrder);

  return paginate(sorted, query.page, query.pageSize);
}

export async function getItem(id) {
  const items = await readDataset();
  return items.find((item) => item.id === Number(id));
}

export async function createItem(input) {
  const items = await readDataset();
  const now = new Date().toISOString();
  const nextId = items.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1;
  const item = {
    id: nextId,
    title: input.title ?? `Record ${nextId}`,
    category: input.category ?? "operations",
    status: input.status ?? "draft",
    score: Number(input.score) || 0,
    owner: input.owner ?? "user-1",
    description: input.description ?? "",
    tags: Array.isArray(input.tags) ? input.tags : [],
    createdAt: now,
    updatedAt: now
  };

  await replaceDataset([...items, item]);
  return item;
}

export async function updateItem(id, input) {
  const items = await readDataset();
  const itemId = Number(id);
  const index = items.findIndex((item) => item.id === itemId);

  if (index === -1) {
    return null;
  }

  const updated = {
    ...items[index],
    ...input,
    id: itemId,
    updatedAt: new Date().toISOString()
  };

  const nextItems = [...items];
  nextItems[index] = updated;
  await replaceDataset(nextItems);
  return updated;
}

export async function deleteItem(id) {
  const items = await readDataset();
  const itemId = Number(id);
  const nextItems = items.filter((item) => item.id !== itemId);

  if (nextItems.length === items.length) {
    return false;
  }

  await replaceDataset(nextItems);
  return true;
}
