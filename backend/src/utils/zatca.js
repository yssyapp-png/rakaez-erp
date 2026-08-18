/**
 * ZATCA Phase 1 (simplified tax invoice) QR code generator.
 *
 * This builds the mandatory Base64 TLV (Tag-Length-Value) payload that must
 * be encoded into a QR code on every simplified tax invoice in Saudi Arabia,
 * per ZATCA's e-invoicing regulation. It does NOT talk to the ZATCA/Fatoora
 * API (Phase 2 - integration/reporting), which additionally requires a
 * registered cryptographic certificate, XML invoice signing, and clearance
 * calls to ZATCA's servers. That is a separate, larger integration project.
 *
 * Fields required for the Phase 1 QR (per ZATCA spec):
 *  1. Seller name
 *  2. Seller VAT registration number
 *  3. Invoice timestamp (ISO 8601)
 *  4. Invoice total (with VAT)
 *  5. VAT amount
 */
function tlv(tag, value) {
  const valueBuf = Buffer.from(String(value), "utf8");
  // Compliance fix: the length is encoded in a single byte (max 255) per the
  // ZATCA TLV spec. Previously, a value longer than 255 bytes silently
  // truncated here (JS keeps only the low 8 bits), producing a malformed,
  // non-compliant QR code with no error — easy to hit with a longer Arabic
  // business name, since Arabic characters take 2 bytes each in UTF-8.
  // Fail loudly instead of emitting a broken invoice.
  if (valueBuf.length > 255) {
    throw new Error(
      `zatca_tlv_value_too_long: tag ${tag} value is ${valueBuf.length} bytes, max 255 allowed by spec`
    );
  }
  return Buffer.concat([Buffer.from([tag, valueBuf.length]), valueBuf]);
}

export function buildZatcaQrBase64({ sellerName, vatNumber, timestampIso, total, vatAmount }) {
  const buf = Buffer.concat([
    tlv(1, sellerName),
    tlv(2, vatNumber),
    tlv(3, timestampIso),
    tlv(4, Number(total).toFixed(2)),
    tlv(5, Number(vatAmount).toFixed(2)),
  ]);
  return buf.toString("base64");
}
