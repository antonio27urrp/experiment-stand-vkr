import cors from "cors";
import express from "express";
import morgan from "morgan";
import {
  createItem,
  deleteItem,
  getItem,
  listItems,
  updateItem
} from "./items-service.js";
import { writeDataset } from "./storage.js";
import { getUiSchema } from "./ui-schema.js";

const app = express();
const port = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "benchmark-backend" });
});

app.post("/seed", async (req, res, next) => {
  try {
    const size = Number(req.query.size ?? req.body.size ?? 100);

    if (![100, 1000, 10000].includes(size)) {
      return res.status(400).json({ error: "size must be one of: 100, 1000, 10000" });
    }

    const items = await writeDataset(size);
    return res.json({ size, count: items.length });
  } catch (error) {
    return next(error);
  }
});

app.get("/items", async (req, res, next) => {
  try {
    const result = await listItems(req.query);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

app.get("/items/:id", async (req, res, next) => {
  try {
    const item = await getItem(req.params.id);

    if (!item) {
      return res.status(404).json({ error: "item not found" });
    }

    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

app.post("/items", async (req, res, next) => {
  try {
    const item = await createItem(req.body);
    return res.status(201).json(item);
  } catch (error) {
    return next(error);
  }
});

app.put("/items/:id", async (req, res, next) => {
  try {
    const item = await updateItem(req.params.id, req.body);

    if (!item) {
      return res.status(404).json({ error: "item not found" });
    }

    return res.json(item);
  } catch (error) {
    return next(error);
  }
});

app.delete("/items/:id", async (req, res, next) => {
  try {
    const deleted = await deleteItem(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: "item not found" });
    }

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

app.get("/ui-schema", (_req, res) => {
  res.json(getUiSchema());
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "internal server error" });
});

app.listen(port, () => {
  console.log(`Benchmark backend listening on http://localhost:${port}`);
});
