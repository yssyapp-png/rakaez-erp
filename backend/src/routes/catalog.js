import { pool } from "../db/pool.js";
import { createSafeRouter } from "../utils/safe-router.js";
import { getCatalogProviderStatuses } from "../utils/catalog-providers.js";

const router = createSafeRouter();

router.get("/providers", (_req, res) => {
  res.json({
    providers: getCatalogProviderStatuses(),
    policy: {
      licensedAccessOnly: true,
      scrapingAllowed: false,
      vinTransmissionEnabled: false,
    },
  });
});

export const SAUDI_STARTER_CATALOG = [
  ["oil-filter", "فلتر زيت المحرك", "فلاتر"],
  ["air-filter", "فلتر هواء المحرك", "فلاتر"],
  ["cabin-filter", "فلتر المكيف", "فلاتر"],
  ["fuel-filter", "فلتر الوقود", "فلاتر"],
  ["front-brake-pads", "فحمات فرامل أمامية", "فرامل"],
  ["rear-brake-pads", "فحمات فرامل خلفية", "فرامل"],
  ["brake-disc", "هوبات فرامل", "فرامل"],
  ["spark-plugs", "بواجي", "محرك"],
  ["ignition-coil", "كويل إشعال", "محرك"],
  ["serpentine-belt", "سير المكينة", "محرك"],
  ["water-pump", "طرمبة ماء", "تبريد"],
  ["radiator", "رديتر", "تبريد"],
  ["thermostat", "بلف حرارة", "تبريد"],
  ["shock-absorber", "مساعد", "تعليق"],
  ["control-arm", "مقص", "تعليق"],
  ["wheel-bearing", "رمان بلي العجل", "تعليق"],
  ["battery", "بطارية سيارة", "كهرباء"],
  ["alternator", "دينمو", "كهرباء"],
  ["starter-motor", "سلف", "كهرباء"],
  ["wiper-blade", "مساحات زجاج", "هيكل"],
];

router.get("/saudi-starter/preview", (_req, res) => {
  res.json({ source: "rakaez-saudi-starter-v1", count: SAUDI_STARTER_CATALOG.length, items: SAUDI_STARTER_CATALOG.map(([key, name, category]) => ({ key, name, category })) });
});

router.post("/saudi-starter/import", async (req, res) => {
  if (req.body?.confirm !== true) return res.status(400).json({ error: "explicit_confirmation_required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const runResult = await client.query(
      `INSERT INTO catalog_import_runs (organization_id, source, requested_by, status)
       VALUES ($1,'rakaez-saudi-starter-v1',$2,'running') RETURNING id`,
      [req.user.organizationId, req.user.id]
    );
    let inserted = 0;
    let skipped = 0;
    for (const [key, name, category] of SAUDI_STARTER_CATALOG) {
      const result = await client.query(
        `INSERT INTO parts
         (organization_id, part_number, name, category, price, cost, catalog_status, catalog_source, catalog_key)
         VALUES ($1,$2,$3,$4,0,0,'draft','rakaez-saudi-starter-v1',$5)
         ON CONFLICT (organization_id, catalog_source, catalog_key) DO NOTHING RETURNING id`,
        [req.user.organizationId, `SA-DRAFT-${key.toUpperCase()}`, name, category, key]
      );
      if (result.rows[0]) inserted += 1; else skipped += 1;
    }
    await client.query(
      `UPDATE catalog_import_runs SET status = 'completed', inserted_count = $1,
       skipped_count = $2, completed_at = now() WHERE id = $3`,
      [inserted, skipped, runResult.rows[0].id]
    );
    await client.query("COMMIT");
    res.status(201).json({ inserted, skipped, status: "completed", itemsAreDrafts: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ error: "catalog_import_failed" });
  } finally {
    client.release();
  }
});

router.get("/parts/:partId/applications", async (req, res) => {
  const part = await pool.query(
    "SELECT id FROM parts WHERE id = $1 AND organization_id = $2",
    [req.params.partId, req.user.organizationId]
  );

  if (!part.rows[0]) {
    return res.status(404).json({ error: "part_not_found" });
  }

  const result = await pool.query(
    `SELECT id, part_id, make, model, year_from, year_to, engine, trim,
            market, source, verification_status
     FROM vehicle_applications
     WHERE organization_id = $1
       AND part_id = $2
     ORDER BY make, model, year_from NULLS FIRST, id`,
    [req.user.organizationId, req.params.partId]
  );

  res.json(result.rows);
});

router.post("/parts/:partId/applications", async (req, res) => {
  const body = req.body || {};
  const make = String(body.make || "").trim();
  const model = String(body.model || "").trim();
  const yearFrom = body.yearFrom == null ? null : Number(body.yearFrom);
  const yearTo = body.yearTo == null ? null : Number(body.yearTo);
  if (!make || make.length > 100 || !model || model.length > 100 ||
      (yearFrom != null && (!Number.isInteger(yearFrom) || yearFrom < 1900 || yearFrom > 2200)) ||
      (yearTo != null && (!Number.isInteger(yearTo) || yearTo < 1900 || yearTo > 2200))) {
    return res.status(400).json({ error: "invalid_vehicle_application" });
  }
  if (yearFrom != null && yearTo != null && yearFrom > yearTo) {
    return res.status(400).json({ error: "invalid_year_range" });
  }
  const part = await pool.query(
    "SELECT id FROM parts WHERE id = $1 AND organization_id = $2",
    [req.params.partId, req.user.organizationId]
  );
  if (!part.rows[0]) return res.status(404).json({ error: "part_not_found" });
  const result = await pool.query(
    `INSERT INTO vehicle_applications
     (organization_id, part_id, make, model, year_from, year_to, engine, trim, market, source, verification_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'SA','manual','unverified') RETURNING *`,
    [req.user.organizationId, req.params.partId, make, model, yearFrom, yearTo,
      String(body.engine || "").trim().slice(0, 100) || null,
      String(body.trim || "").trim().slice(0, 100) || null]
  );
  res.status(201).json(result.rows[0]);
});

router.patch("/applications/:applicationId/status", async (req, res) => {
  const status = String(req.body?.status || "").trim().toLowerCase();

  if (!["unverified", "verified", "rejected"].includes(status)) {
    return res.status(400).json({ error: "invalid_verification_status" });
  }

  const result = await pool.query(
    `UPDATE vehicle_applications
     SET verification_status = $1
     WHERE id = $2
       AND organization_id = $3
     RETURNING id, part_id, make, model, year_from, year_to, engine, trim,
               market, source, verification_status`,
    [status, req.params.applicationId, req.user.organizationId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "application_not_found" });
  }

  res.json(result.rows[0]);
});

router.delete("/applications/:applicationId", async (req, res) => {
  const result = await pool.query(
    `DELETE FROM vehicle_applications
     WHERE id = $1
       AND organization_id = $2
     RETURNING id`,
    [req.params.applicationId, req.user.organizationId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: "application_not_found" });
  }

  res.json({ ok: true });
});

export default router;
