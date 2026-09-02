"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, FileCheck2, Plus, Printer, QrCode, ReceiptText, Save, ShieldCheck, Trash2 } from "lucide-react";
import type { Locale } from "@/app/i18n";
import { calculateInvoiceTotals } from "@/app/invoice-math";

type Line = { id: string; partNumber: string; description: string; quantity: number; unitPrice: number; discount: number };

const copy = {
  ar: { title:"الفوترة الإلكترونية", subtitle:"إنشاء فاتورة بيع أو شراء باسم الطرف المقابل وربطها بالدفع والصندوق", newInvoice:"فاتورة جديدة", transaction:"نوع العملية", sale:"بيع", purchase:"شراء", invoiceType:"نوع الفاتورة", simplified:"فاتورة ضريبية مبسطة", standard:"فاتورة ضريبية", customer:"بيانات العميل", customerName:"اسم العميل", supplierName:"اسم المورد", customerVat:"الرقم الضريبي للطرف المقابل", seller:"بيانات المتجر", sellerName:"اسم المتجر القانوني", sellerVat:"الرقم الضريبي للمتجر", sellerAddress:"عنوان المتجر", payment:"طريقة الدفع", cash:"نقدي", card:"بطاقة / مدى", transfer:"تحويل بنكي", partNumber:"رقم القطعة", description:"وصف القطعة", quantity:"الكمية", unitPrice:"سعر الوحدة", discount:"الخصم", vat:"ضريبة 15%", lineTotal:"الإجمالي", addLine:"إضافة قطعة", subtotal:"الإجمالي قبل الضريبة", discountTotal:"إجمالي الخصم", vatTotal:"ضريبة القيمة المضافة", grandTotal:"الإجمالي شامل الضريبة", save:"حفظ وإصدار الفاتورة", saving:"جارٍ الحفظ", print:"طباعة", saved:"تم إصدار الفاتورة", required:"أكمل اسم الطرف المقابل وبيانات المتجر وبنود الفاتورة", failed:"تعذر حفظ الفاتورة، حاول مجددًا", invoiceNumber:"رقم الفاتورة", draft:"مسودة", sar:"ر.س", readiness:"خدمات الفاتورة", services:["حساب ضريبة القيمة المضافة تلقائيًا","فاتورة عربية وإنجليزية","رقم تسلسلي ووقت إصدار","تهيئة QR وXML للربط","تهيئة الإشعارات الدائنة والمدينة","حفظ إلكتروني وسجل تدقيق"], integration:"البيع والشراء النقدي يسجلان في الصندوق تلقائيًا، والمدفوعات الشبكية تبقى مرتبطة برقم الفاتورة." },
  en: { title:"Electronic invoicing", subtitle:"Create a sale or purchase invoice linked to payment and cash control", newInvoice:"New invoice", transaction:"Transaction type", sale:"Sale", purchase:"Purchase", invoiceType:"Invoice type", simplified:"Simplified tax invoice", standard:"Tax invoice", customer:"Customer details", customerName:"Customer name", supplierName:"Supplier name", customerVat:"Counterparty VAT number", seller:"Store details", sellerName:"Legal store name", sellerVat:"Store VAT number", sellerAddress:"Store address", payment:"Payment method", cash:"Cash", card:"Card / Mada", transfer:"Bank transfer", partNumber:"Part number", description:"Part description", quantity:"Qty", unitPrice:"Unit price", discount:"Discount", vat:"VAT 15%", lineTotal:"Total", addLine:"Add part", subtotal:"Subtotal before VAT", discountTotal:"Total discount", vatTotal:"Value-added tax", grandTotal:"Total including VAT", save:"Save and issue invoice", saving:"Saving", print:"Print", saved:"Invoice issued", required:"Complete the counterparty, store, and invoice-line details", failed:"Invoice could not be saved. Try again", invoiceNumber:"Invoice number", draft:"Draft", sar:"SAR", readiness:"Invoice services", services:["Automatic VAT calculation","Arabic and English invoice","Sequential number and issue time","QR and XML integration readiness","Credit and debit note readiness","Electronic retention and audit trail"], integration:"Cash sales and purchases post to the cash register automatically; network payments remain linked to the invoice." },
} as const;

const newLine = (): Line => ({ id: crypto.randomUUID(), partNumber:"", description:"", quantity:1, unitPrice:0, discount:0 });
export function InvoiceView({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const [invoiceType, setInvoiceType] = useState("simplified");
  const [transactionType, setTransactionType] = useState<"sale"|"purchase">("sale");
  const [customerName, setCustomerName] = useState("");
  const [customerVat, setCustomerVat] = useState("");
  const [sellerName, setSellerName] = useState("ركائز لقطع غيار السيارات");
  const [sellerVat, setSellerVat] = useState("");
  const [sellerAddress, setSellerAddress] = useState("جدة، المملكة العربية السعودية");
  const [paymentMethod, setPaymentMethod] = useState("card");
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [status, setStatus] = useState<"idle"|"saving"|"saved"|"error"|"invalid">("idle");
  const [invoiceNumber, setInvoiceNumber] = useState("");

  const totals = useMemo(() => {
    const value = calculateInvoiceTotals(lines);
    return { subtotal:value.subtotalMinor/100, discount:value.discountMinor/100, vat:value.vatMinor/100, total:value.totalMinor/100 };
  }, [lines]);

  const updateLine = (id:string, field:keyof Line, value:string|number) => setLines(current => current.map(line => line.id === id ? { ...line, [field]:value } : line));
  const issueInvoice = async () => {
    if (!customerName.trim() || !sellerName.trim() || !sellerVat.trim() || !sellerAddress.trim() || lines.some(line => !line.partNumber.trim() || !line.description.trim() || line.quantity <= 0 || line.unitPrice < 0)) return setStatus("invalid");
    setStatus("saving");
    try {
      const response = await fetch("/api/invoices", { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ transactionType, invoiceType, customerName, customerVat, sellerName, sellerVat, sellerAddress, paymentMethod, lines }) });
      const data = await response.json() as { invoiceNumber?:string };
      if (!response.ok || !data.invoiceNumber) throw new Error("invoice_failed");
      setInvoiceNumber(data.invoiceNumber); setStatus("saved");
    } catch { setStatus("error"); }
  };

  return <section className="invoice-workspace" aria-labelledby="invoice-title">
    <div className="invoice-toolbar"><div><span><ReceiptText size={17}/>{t.newInvoice}</span><h2 id="invoice-title">{t.title}</h2><p>{t.subtitle}</p></div><div className="invoice-toolbar-actions"><Badge>{invoiceNumber || t.draft}</Badge><Button variant="outline" onClick={() => window.print()} disabled={!invoiceNumber}><Printer size={16}/>{t.print}</Button></div></div>
    <div className="invoice-layout"><article className="invoice-editor">
      <div className="invoice-form-grid"><label>{t.transaction}<Select value={transactionType} onValueChange={(value)=>setTransactionType(value as "sale"|"purchase")}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="sale">{t.sale}</SelectItem><SelectItem value="purchase">{t.purchase}</SelectItem></SelectContent></Select></label><label>{t.invoiceType}<Select value={invoiceType} onValueChange={setInvoiceType}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="simplified">{t.simplified}</SelectItem><SelectItem value="standard">{t.standard}</SelectItem></SelectContent></Select></label><label>{t.payment}<Select value={paymentMethod} onValueChange={setPaymentMethod}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent><SelectItem value="cash">{t.cash}</SelectItem><SelectItem value="card">{t.card}</SelectItem><SelectItem value="transfer">{t.transfer}</SelectItem></SelectContent></Select></label></div>
      <div className="invoice-parties"><fieldset><legend>{transactionType==="sale"?t.customer:t.supplierName}</legend><label>{transactionType==="sale"?t.customerName:t.supplierName}<Input value={customerName} onChange={e=>setCustomerName(e.target.value)}/></label><label>{t.customerVat}<Input dir="ltr" inputMode="numeric" maxLength={15} value={customerVat} onChange={e=>setCustomerVat(e.target.value.replace(/\D/g,""))}/></label></fieldset><fieldset><legend>{t.seller}</legend><label>{t.sellerName}<Input value={sellerName} onChange={e=>setSellerName(e.target.value)}/></label><label>{t.sellerVat}<Input dir="ltr" inputMode="numeric" maxLength={15} value={sellerVat} onChange={e=>setSellerVat(e.target.value.replace(/\D/g,""))}/></label><label>{t.sellerAddress}<Input value={sellerAddress} onChange={e=>setSellerAddress(e.target.value)}/></label></fieldset></div>
      <div className="invoice-lines"><div className="invoice-line invoice-line-head"><span>{t.partNumber}</span><span>{t.description}</span><span>{t.quantity}</span><span>{t.unitPrice}</span><span>{t.discount}</span><span aria-hidden="true"/></div>{lines.map(line=><div className="invoice-line" key={line.id}><Input dir="ltr" value={line.partNumber} onChange={e=>updateLine(line.id,"partNumber",e.target.value.toUpperCase())}/><Input value={line.description} onChange={e=>updateLine(line.id,"description",e.target.value)}/><Input dir="ltr" type="number" min="1" step="1" value={line.quantity} onChange={e=>updateLine(line.id,"quantity",Math.max(1,Number(e.target.value)))}/><Input dir="ltr" type="number" min="0" step="0.01" value={line.unitPrice} onChange={e=>updateLine(line.id,"unitPrice",Math.max(0,Number(e.target.value)))}/><Input dir="ltr" type="number" min="0" step="0.01" value={line.discount} onChange={e=>updateLine(line.id,"discount",Math.max(0,Number(e.target.value)))}/><Button variant="ghost" size="icon" aria-label={t.discount} disabled={lines.length===1} onClick={()=>setLines(current=>current.filter(item=>item.id!==line.id))}><Trash2 size={16}/></Button></div>)}</div>
      <Button variant="outline" className="add-invoice-line" onClick={()=>setLines(current=>[...current,newLine()])}><Plus size={16}/>{t.addLine}</Button>
      <div className="invoice-footer"><div className="invoice-qr"><QrCode size={48}/><span>{t.integration}</span></div><div className="invoice-totals"><p><span>{t.subtotal}</span><b>{totals.subtotal.toFixed(2)} {t.sar}</b></p><p><span>{t.discountTotal}</span><b>- {totals.discount.toFixed(2)} {t.sar}</b></p><p><span>{t.vatTotal}</span><b>{totals.vat.toFixed(2)} {t.sar}</b></p><p className="invoice-grand"><span>{t.grandTotal}</span><b>{totals.total.toFixed(2)} {t.sar}</b></p></div></div>
      {(status==="invalid"||status==="error"||status==="saved")&&<p className={`invoice-message ${status}`}>{status==="saved"?<CheckCircle2 size={16}/>:null}{status==="saved"?`${t.saved}: ${invoiceNumber}`:status==="invalid"?t.required:t.failed}</p>}
      <Button className="issue-invoice" onClick={issueInvoice} disabled={status==="saving"}><Save size={17}/>{status==="saving"?t.saving:t.save}</Button>
    </article><aside className="invoice-services"><div><FileCheck2 size={22}/><h3>{t.readiness}</h3></div>{t.services.map(service=><p key={service}><ShieldCheck size={15}/>{service}</p>)}</aside></div>
  </section>;
}
