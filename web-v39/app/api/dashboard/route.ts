import { and, asc, count, eq, lte, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "../../../db";
import { inventoryItems, parts, partTranslations, workshopRequests } from "../../../db/schema";

export async function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("locale") === "en" ? "en" : "ar";
  const fallbackLocale = locale === "ar" ? "en" : "ar";

  try {
    const db = getDb();
    const requestedTranslation = alias(partTranslations, "requested_translation");
    const fallbackTranslation = alias(partTranslations, "fallback_translation");
    const [partCount, stockTotals, lowStockCount, workshopCount, inventory] = await Promise.all([
      db.select({ value: count() }).from(parts),
      db.select({ onHand: sum(inventoryItems.onHand), reserved: sum(inventoryItems.reserved) }).from(inventoryItems),
      db.select({ value: count() }).from(inventoryItems).where(lte(inventoryItems.onHand, inventoryItems.reorderPoint)),
      db.select({ value: count() }).from(workshopRequests).where(
        sql`${workshopRequests.status} NOT IN ('delivered', 'returned', 'cancelled')`,
      ),
      db.select({
        id: inventoryItems.id,
        number: parts.partNumberOriginal,
        name: sql<string>`coalesce(${requestedTranslation.name}, ${fallbackTranslation.name}, ${parts.partNumberOriginal})`,
        translationLocale: sql<string>`coalesce(${requestedTranslation.locale}, ${fallbackTranslation.locale}, 'identifier')`,
        translationFallback: sql<number>`case when ${requestedTranslation.id} is null then 1 else 0 end`,
        quantity: inventoryItems.onHand,
        reserved: inventoryItems.reserved,
        reorderPoint: inventoryItems.reorderPoint,
        shelf: inventoryItems.shelfCode,
      })
        .from(inventoryItems)
        .innerJoin(parts, eq(inventoryItems.partId, parts.id))
        .leftJoin(requestedTranslation, and(
          eq(requestedTranslation.partId, parts.id),
          eq(requestedTranslation.locale, locale),
        ))
        .leftJoin(fallbackTranslation, and(
          eq(fallbackTranslation.partId, parts.id),
          eq(fallbackTranslation.locale, fallbackLocale),
        ))
        .orderBy(asc(inventoryItems.onHand))
        .limit(50),
    ]);

    return Response.json({
      updatedAt: new Date().toISOString(),
      stats: {
        totalParts: partCount[0]?.value ?? 0,
        onHand: Number(stockTotals[0]?.onHand ?? 0),
        reserved: Number(stockTotals[0]?.reserved ?? 0),
        lowStock: lowStockCount[0]?.value ?? 0,
        workshopRequests: workshopCount[0]?.value ?? 0,
      },
      inventory: inventory.map((item) => ({
        ...item,
        translationFallback: Boolean(item.translationFallback),
        status: item.quantity === 0 ? "out" : item.quantity <= item.reorderPoint ? "low" : "available",
      })),
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json(
      { error: "dashboard_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
}
