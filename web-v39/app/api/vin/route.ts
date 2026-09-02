import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { vehicleVinRecords } from "../../../db/schema";

const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/;

export async function GET(request: Request) {
  const vin = (new URL(request.url).searchParams.get("vin") ?? "").trim().toUpperCase();
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  if (!VIN_PATTERN.test(vin)) return Response.json({ error: "invalid_vin" }, { status: 400, headers });
  try {
    const db = getDb();
    const record = await db.select().from(vehicleVinRecords).where(eq(vehicleVinRecords.vin, vin)).limit(1);
    if (!record[0]) return Response.json({ error: "vin_not_found" }, { status: 404, headers });
    const vehicle = record[0];
    return Response.json({ vin: vehicle.vin, vehicle: { make: vehicle.make, model: vehicle.model, modelYear: vehicle.modelYear, engine: vehicle.engine }, updatedAt: vehicle.updatedAt }, { headers });
  } catch {
    return Response.json({ error: "vin_search_unavailable" }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
