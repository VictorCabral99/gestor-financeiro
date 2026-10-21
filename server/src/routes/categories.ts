import { Router } from "express";
import { db } from "../db.js";
import { notFound, validateBody } from "../lib/http.js";
import { pickCategoryColor } from "../lib/categoryColors.js";
import { categoryCreateSchema, categoryUpdateSchema } from "../lib/schemas.js";

export const categoriesRouter = Router();

categoriesRouter.get("/", (_req, res) => {
  res.json(
    db
      .prepare(
        `SELECT * FROM categories WHERE archived = 0
         ORDER BY COALESCE(parent_id, id),
                  CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END,
                  name COLLATE NOCASE`,
      )
      .all(),
  );
});

categoriesRouter.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(Number(req.params.id));
  if (!row) notFound("Categoria");
  res.json(row);
});

categoriesRouter.post("/", validateBody(categoryCreateSchema), (req, res) => {
  const { name, parent_id, color } = req.body;
  if (parent_id) {
    const parent = db.prepare(`SELECT id FROM categories WHERE id = ?`).get(parent_id);
    if (!parent) notFound("Categoria pai");
  }

  const used = (
    db.prepare(`SELECT color FROM categories`).all() as { color: string }[]
  ).map((r) => r.color);
  const resolvedColor = color?.trim() || pickCategoryColor(used);

  const result = db
    .prepare(`INSERT INTO categories (name, parent_id, color) VALUES (?, ?, ?)`)
    .run(name, parent_id ?? null, resolvedColor);
  res
    .status(201)
    .json(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(result.lastInsertRowid));
});

categoriesRouter.patch("/:id", validateBody(categoryUpdateSchema), (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id) as
    | { name: string; parent_id: number | null; color: string; archived: number }
    | undefined;
  if (!current) notFound("Categoria");

  db.prepare(
    `UPDATE categories SET name = ?, parent_id = ?, color = ?, archived = ? WHERE id = ?`,
  ).run(
    req.body.name ?? current.name,
    req.body.parent_id !== undefined ? req.body.parent_id : current.parent_id,
    req.body.color ?? current.color,
    req.body.archived !== undefined ? (req.body.archived ? 1 : 0) : current.archived,
    id,
  );
  res.json(db.prepare(`SELECT * FROM categories WHERE id = ?`).get(id));
});
