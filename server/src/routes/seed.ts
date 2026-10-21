import { Router } from "express";
import { db } from "../db.js";
import { pickCategoryColor } from "../lib/categoryColors.js";

const SEED = [
  { name: "Moradia", children: ["Aluguel", "Condomínio", "Contas"] },
  { name: "Alimentação", children: ["Mercado", "Almoço", "Delivery"] },
  { name: "Transporte", children: ["Combustível", "App", "Transporte público"] },
  { name: "Saúde", children: ["Plano", "Farmácia", "Consultas"] },
  { name: "Lazer", children: ["Streaming", "Passeios"] },
  { name: "Educação", children: ["Cursos", "Livros"] },
  { name: "Financeiro", children: ["Cartão", "Tarifas", "Investimentos"] },
];

export const seedRouter = Router();

seedRouter.post("/categories", (_req, res) => {
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM categories`).get() as { n: number };
  if (existing.n > 0) {
    res.status(409).json({ error: "Já existem categorias; seed ignorado" });
    return;
  }

  const insert = db.prepare(
    `INSERT INTO categories (name, parent_id, color) VALUES (?, ?, ?)`,
  );

  const tx = db.transaction(() => {
    const used: string[] = [];
    for (const cat of SEED) {
      const parentColor = pickCategoryColor(used);
      used.push(parentColor);
      const parent = insert.run(cat.name, null, parentColor);
      const parentId = Number(parent.lastInsertRowid);
      for (const child of cat.children) {
        const childColor = pickCategoryColor(used);
        used.push(childColor);
        insert.run(child, parentId, childColor);
      }
    }
  });
  tx();

  res.status(201).json(db.prepare(`SELECT * FROM categories ORDER BY id`).all());
});
