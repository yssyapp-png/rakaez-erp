import { env } from "cloudflare:workers";

const headers = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" };
const text = (value:unknown, max:number) => typeof value === "string" ? value.trim().slice(0,max) : "";

export async function POST(request:Request) {
  try {
    const body = await request.json() as Record<string,unknown>;
    const movementType = body.movementType === "withdrawal" ? "withdrawal" : body.movementType === "adjustment" ? "adjustment" : "deposit";
    const amount = Number(body.amount);
    const amountMinor = Math.round(amount * 100);
    const cashierName = text(body.cashierName,160);
    const depositReference = text(body.depositReference,120);
    const note = text(body.note,240);
    if (!cashierName || !Number.isFinite(amount) || amountMinor <= 0 || (movementType === "deposit" && !depositReference)) return Response.json({ error:"invalid_cash_movement" }, { status:400, headers });
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO cash_movements (id,movement_type,amount_minor,cashier_name,deposit_reference,invoice_id,note) VALUES (?,?,?,?,?,?,?)`).bind(id,movementType,amountMinor,cashierName,depositReference,null,note).run();
    return Response.json({ id, movementType, amountMinor, createdAt:new Date().toISOString() }, { status:201, headers });
  } catch { return Response.json({ error:"cash_register_unavailable" }, { status:503, headers:{ ...headers, "Retry-After":"30" } }); }
}

export async function GET() {
  try {
    const result = await env.DB.prepare(`SELECT id,movement_type,amount_minor,cashier_name,deposit_reference,invoice_id,note,created_at FROM cash_movements ORDER BY created_at DESC LIMIT 100`).all();
    const rows = result.results as Array<Record<string,unknown>>;
    const balanceMinor = rows.reduce((sum,row)=>sum + (row.movement_type === "cash_sale" || row.movement_type === "adjustment" ? Number(row.amount_minor) : -Number(row.amount_minor)),0);
    const salesMinor = rows.filter(row=>row.movement_type === "cash_sale").reduce((sum,row)=>sum+Number(row.amount_minor),0);
    const depositsMinor = rows.filter(row=>row.movement_type === "deposit").reduce((sum,row)=>sum+Number(row.amount_minor),0);
    const purchasesMinor = rows.filter(row=>row.movement_type === "cash_purchase").reduce((sum,row)=>sum+Number(row.amount_minor),0);
    return Response.json({ balanceMinor, salesMinor, purchasesMinor, depositsMinor, items:rows }, { headers });
  } catch { return Response.json({ error:"cash_register_unavailable" }, { status:503, headers:{ ...headers, "Retry-After":"30" } }); }
}
