import { Router } from "express";
import { pool } from "../db/pool.js";

const router = Router();

export function normalizeVin(value) {
  const vin = String(value || "").trim().toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null;
}

function validYear(value) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= new Date().getFullYear() + 1;
}

router.get("/", async (req, res) => {
  const result = await pool.query(
    `SELECT id, vin, nickname, make, model, model_year, engine, trim, plate_number, created_at, updated_at
     FROM customer_vehicles WHERE organization_id = $1 AND user_id = $2
     ORDER BY updated_at DESC`,
    [req.user.organizationId, req.user.id]
  );
  res.json(result.rows);
});

router.post("/", async (req, res) => {
  const vin = normalizeVin(req.body.vin);
  const make = String(req.body.make || "").trim();
  const model = String(req.body.model || "").trim();
  const modelYear = Number(req.body.modelYear);
  if (!vin) return res.status(400).json({ error: "invalid_vin" });
  if (!make || !model || !validYear(modelYear)) return res.status(400).json({ error: "vehicle_details_required" });
  try {
    const result = await pool.query(
      `INSERT INTO customer_vehicles
       (organization_id, user_id, vin, nickname, make, model, model_year, engine, trim, plate_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (user_id, vin) DO UPDATE SET
         nickname = EXCLUDED.nickname, make = EXCLUDED.make, model = EXCLUDED.model,
         model_year = EXCLUDED.model_year, engine = EXCLUDED.engine, trim = EXCLUDED.trim,
         plate_number = EXCLUDED.plate_number, updated_at = now()
       RETURNING id, vin, nickname, make, model, model_year, engine, trim, plate_number, created_at, updated_at`,
      [req.user.organizationId, req.user.id, vin, req.body.nickname || null, make, model, modelYear,
        req.body.engine || null, req.body.trim || null, req.body.plateNumber || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "vehicle_save_failed" });
  }
});

router.delete("/:id", async (req, res) => {
  const result = await pool.query(
    `DELETE FROM customer_vehicles WHERE id = $1 AND organization_id = $2 AND user_id = $3 RETURNING id`,
    [req.params.id, req.user.organizationId, req.user.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "vehicle_not_found" });
  res.json({ ok: true });
});

export default router;
