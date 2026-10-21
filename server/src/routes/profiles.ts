import { Router } from "express";
import { z } from "zod";
import { evictProfile, runWithProfile } from "../db.js";
import { validateBody } from "../lib/http.js";
import {
  createProfile,
  deleteProfile,
  listProfiles,
  renameProfile,
} from "../profiles.js";
import { syncMonths } from "../services/months.js";
import { refreshAllInvoiceDates } from "../services/invoices.js";

export const profilesRouter = Router();

const nameSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do perfil").max(60),
});

profilesRouter.get("/", (_req, res) => {
  res.json(listProfiles());
});

profilesRouter.post("/", validateBody(nameSchema), (req, res) => {
  const profile = createProfile(req.body.name);
  // Abre o banco vazio e sincroniza meses do perfil novo
  runWithProfile(profile.id, () => {
    syncMonths();
    refreshAllInvoiceDates();
  });
  res.status(201).json(profile);
});

profilesRouter.patch("/:id", validateBody(nameSchema), (req, res) => {
  const profile = renameProfile(req.params.id, req.body.name);
  res.json(profile);
});

profilesRouter.delete("/:id", (req, res) => {
  const id = req.params.id;
  evictProfile(id);
  const result = deleteProfile(id);
  res.json(result);
});
