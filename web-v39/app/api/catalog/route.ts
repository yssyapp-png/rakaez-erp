import { and, eq, like, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { getDb } from "../../../db";
import { parts, partTranslations } from "../../../db/schema";

const normalizeDigits = (value: string) => value
  .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale") === "en" ? "en" : "ar";
  const fallbackLocale = locale === "ar" ? "en" : "ar";
  const rawQuery = url.searchParams.get("q")?.trim() ?? "";
  if (rawQuery.length > 64) {
    return Response.json({ error: "invalid_query" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const searchText = normalizeDigits(rawQuery).replace(/\s+/g, " ");
  const identifierQuery = searchText.toUpperCase().replace(/[^A-Z0-9-]/g, "");

  try {
    const db = getDb();
    const requestedTranslation = alias(partTranslations, "requested_translation");
    const fallbackTranslation = alias(partTranslations, "fallback_translation");
    const textPattern = `%${searchText}%`;
    const where = searchText
      ? or(
          identifierQuery ? like(parts.partNumberNormalized, `%${identifierQuery}%`) : undefined,
          like(requestedTranslation.name, textPattern),
          like(fallbackTranslation.name, textPattern),
        )
      : undefined;

    const rows = await db
      .select({
        id: parts.id,
        partNumber: parts.partNumberOriginal,
        brandCode: parts.brandCode,
        name: sql<string>`coalesce(${requestedTranslation.name}, ${fallbackTranslation.name}, ${parts.partNumberOriginal})`,
        locale: sql<string>`coalesce(${requestedTranslation.locale}, ${fallbackTranslation.locale}, 'identifier')`,
        reviewStatus: sql<string>`coalesce(${requestedTranslation.reviewStatus}, ${fallbackTranslation.reviewStatus}, 'untranslated')`,
        translationFallback: sql<number>`case when ${requestedTranslation.id} is null then 1 else 0 end`,
      })
      .from(parts)
      .leftJoin(requestedTranslation, and(
        eq(parts.id, requestedTranslation.partId),
        eq(requestedTranslation.locale, locale),
      ))
      .leftJoin(fallbackTranslation, and(
        eq(parts.id, fallbackTranslation.partId),
        eq(fallbackTranslation.locale, fallbackLocale),
      ))
      .where(where)
      .limit(50);

    return Response.json(
      { data: rows.map((row) => ({ ...row, translationFallback: Boolean(row.translationFallback) })), locale, query: identifierQuery || searchText, count: rows.length },
      { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } },
    );
  } catch {
    return Response.json(
      { error: "catalog_unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
}
