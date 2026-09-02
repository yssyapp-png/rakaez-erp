import { env } from "cloudflare:workers";
import { calculateInvoiceTotals } from "@/app/invoice-math";

const headers = { "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff" };
const text = (value:unknown, max:number) => typeof value === "string" ? value.trim().slice(0,max) : "";

export async function POST(request:Request) {
  try {
    const body = await request.json() as Record<string,unknown>;
    const invoiceType = body.invoiceType === "standard" ? "standard" : "simplified";
    const transactionType = body.transactionType === "purchase" ? "purchase" : "sale";
    const paymentMethod = ["cash","card","transfer"].includes(String(body.paymentMethod)) ? String(body.paymentMethod) : "card";
    const customerName = text(body.partyName ?? body.customerName,160);
    const customerVat = text(body.customerVat,15);
    const sellerName = text(body.sellerName,160);
    const sellerVat = text(body.sellerVat,15);
    const sellerAddress = text(body.sellerAddress,240);
    const rawLines = Array.isArray(body.lines) ? body.lines.slice(0,100) : [];
    if (!customerName || !sellerName || !sellerAddress || !/^3\d{13}3$/.test(sellerVat) || (customerVat && !/^3\d{13}3$/.test(customerVat)) || (invoiceType === "standard" && !customerVat) || !rawLines.length) {
      return Response.json({ error:"invalid_invoice" }, { status:400, headers });
    }

    const inputLines = rawLines.map((entry) => {
      const line = entry as Record<string,unknown>;
      const quantity = Number(line.quantity);
      return { id:crypto.randomUUID(), partNumber:text(line.partNumber,80).toUpperCase(), description:text(line.description,240), quantity, unitPrice:Number(line.unitPrice), discount:Number(line.discount) };
    });
    if (inputLines.some(line => !line.partNumber || !line.description || !Number.isInteger(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0 || !Number.isFinite(line.discount) || line.discount < 0)) {
      return Response.json({ error:"invalid_invoice_lines" }, { status:400, headers });
    }
    const calculated = calculateInvoiceTotals(inputLines);
    const lines = inputLines.map((line,index)=>({ ...line, ...calculated.lines[index] }));
    const { subtotalMinor, discountMinor, vatMinor, totalMinor } = calculated;
    const id = crypto.randomUUID();
    const issuedAt = new Date().toISOString();
    const invoiceNumber = `RKZ-${transactionType === "purchase" ? "PUR" : "SAL"}-${issuedAt.slice(0,10).replace(/-/g,"")}-${id.slice(0,8).toUpperCase()}`;
    const invoiceStatement = env.DB.prepare(`INSERT INTO sales_invoices (id,invoice_number,transaction_type,invoice_type,status,customer_name,customer_vat_number,seller_name,seller_vat_number,seller_address,payment_method,currency,subtotal_minor,discount_minor,vat_minor,total_minor,issued_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,invoiceNumber,transactionType,invoiceType,"issued",customerName,customerVat,sellerName,sellerVat,sellerAddress,paymentMethod,"SAR",subtotalMinor,discountMinor,vatMinor,totalMinor,issuedAt);
    const lineStatements = lines.map(line => env.DB.prepare(`INSERT INTO sales_invoice_lines (id,invoice_id,part_number,description,quantity,unit_price_minor,discount_minor,vat_rate_bps,vat_minor,line_total_minor) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(line.id,id,line.partNumber,line.description,line.quantity,line.unitPriceMinor,line.discountMinor,1500,line.vatMinor,line.lineTotalMinor));
    const cashSale = paymentMethod === "cash" ? env.DB.prepare(`INSERT INTO cash_movements (id,movement_type,amount_minor,cashier_name,deposit_reference,invoice_id,note) VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),transactionType === "purchase" ? "cash_purchase" : "cash_sale",totalMinor,sellerName,"",id,`${transactionType === "purchase" ? "Cash purchase" : "Cash sale"} ${invoiceNumber}`) : null;
    await env.DB.batch([invoiceStatement,...lineStatements,...(cashSale ? [cashSale] : [])]);
    return Response.json({ id, invoiceNumber, issuedAt, subtotalMinor, discountMinor, vatMinor, totalMinor }, { status:201, headers });
  } catch {
    return Response.json({ error:"invoice_unavailable" }, { status:503, headers:{ ...headers, "Retry-After":"30" } });
  }
}

export async function GET() {
  try {
    const result = await env.DB.prepare(`SELECT id,invoice_number,transaction_type,invoice_type,status,customer_name,payment_method,currency,total_minor,issued_at FROM sales_invoices ORDER BY issued_at DESC LIMIT 50`).all();
    return Response.json({ items:result.results }, { headers });
  } catch {
    return Response.json({ error:"invoices_unavailable" }, { status:503, headers:{ ...headers, "Retry-After":"30" } });
  }
}
