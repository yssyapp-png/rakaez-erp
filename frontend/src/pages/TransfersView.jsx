import React, { useEffect, useMemo, useState } from "react";
import {
  cancelInventoryTransfer,
  createInventoryTransfer,
  getAllParts,
  getBranchesSummary,
  getInventoryTransfers,
  isDevicePaired,
  receiveInventoryTransfer,
  shipInventoryTransfer,
} from "../api/client.js";
import { useLanguage } from "../i18n/LanguageContext.jsx";

const EMPTY_LINE = { partId: "", quantity: 1 };

const STATUS_CLASS = {
  received: "success",
  in_transit: "success",
  received_with_variance: "danger",
  cancelled: "danger",
};

export default function TransfersView({ user }) {
  const { t } = useLanguage();
  const [transfers, setTransfers] = useState([]);
  const [parts, setParts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [devicePaired, setDevicePaired] = useState(false);

  async function reload() {
    const nextTransfers = await getInventoryTransfers();
    if (nextTransfers?.error) throw new Error(nextTransfers.error);
    setTransfers(Array.isArray(nextTransfers) ? nextTransfers : []);
    if (user.role === "admin") {
      const [nextParts, nextBranches] = await Promise.all([getAllParts(), getBranchesSummary()]);
      setParts(Array.isArray(nextParts) ? nextParts : []);
      setBranches(Array.isArray(nextBranches) ? nextBranches : []);
    }
  }

  useEffect(() => {
    reload().catch(() => setMessage({ type: "error", text: t("transfers_load_error") }));
    isDevicePaired().then(setDevicePaired).catch(() => setDevicePaired(false));
  }, []);

  async function run(action, successKey) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (result?.error) throw new Error(result.error);
      await reload();
      setMessage({ type: "success", text: t(successKey) });
      return true;
    } catch (error) {
      setMessage({ type: "error", text: `${t("error_prefix")}: ${t(`err_${error.message}`)}` });
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="rk-page-heading">
        <div><h2>{t("transfers_title")}</h2><p>{t("transfers_subtitle")}</p></div>
        <span className="rk-badge success">{t("audited_workflow")}</span>
      </div>
      {message && <div className={`rk-alert ${message.type}`}>{message.text}</div>}
      {user.role === "admin" && (
        <TransferForm
          parts={parts}
          branches={branches}
          busy={busy}
          t={t}
          onSubmit={(payload, reference) => run(
            () => createInventoryTransfer(payload, reference),
            "transfer_created"
          )}
        />
      )}
      <div className="rk-card" style={{ marginTop: 18 }}>
        <h3>{t("inventory_transfers")}</h3>
        {!transfers.length ? <p>{t("no_inventory_transfers")}</p> : (
          <div className="rk-table-wrap"><table className="rk-table">
            <thead><tr>
              <th>{t("transfer_number")}</th><th>{t("transfer_route")}</th>
              <th>{t("status_label")}</th><th>{t("items_and_receipts")}</th><th>{t("actions")}</th>
            </tr></thead>
            <tbody>{transfers.map((transfer) => (
              <TransferRow key={transfer.id} transfer={transfer} user={user} busy={busy} run={run} t={t} devicePaired={devicePaired} />
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}

function TransferForm({ parts, branches, busy, onSubmit, t }) {
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [requestReference, setRequestReference] = useState(() => crypto.randomUUID());
  const destinationOptions = useMemo(
    () => branches.filter((branch) => String(branch.id) !== String(sourceBranchId)),
    [branches, sourceBranchId]
  );

  function updateLine(index, patch) {
    setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line));
  }

  async function submit(event) {
    event.preventDefault();
    const success = await onSubmit({
      sourceBranchId: Number(sourceBranchId),
      destinationBranchId: Number(destinationBranchId),
      notes,
      items: lines.map((line) => ({ partId: Number(line.partId), quantity: Number(line.quantity) })),
    }, requestReference);
    if (success) {
      setNotes("");
      setLines([{ ...EMPTY_LINE }]);
      setRequestReference(crypto.randomUUID());
    }
  }

  return (
    <form className="rk-card" onSubmit={submit}>
      <h3>{t("new_inventory_transfer")}</h3>
      <div className="rk-form-grid">
        <select className="rk-select" required value={sourceBranchId} onChange={(event) => {
          setSourceBranchId(event.target.value);
          if (event.target.value === destinationBranchId) setDestinationBranchId("");
        }}>
          <option value="">{t("source_branch")}</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <select className="rk-select" required value={destinationBranchId} onChange={(event) => setDestinationBranchId(event.target.value)}>
          <option value="">{t("destination_branch")}</option>
          {destinationOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
        <input className="rk-input" placeholder={t("notes_optional")} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </div>
      <div className="rk-order-lines">{lines.map((line, index) => (
        <div className="rk-order-line rk-transfer-line" key={index}>
          <select className="rk-select" required value={line.partId} onChange={(event) => updateLine(index, { partId: event.target.value })}>
            <option value="">{t("choose_part")}</option>
            {parts.map((part) => <option key={part.id} value={part.id}>{part.part_number} — {part.name}</option>)}
          </select>
          <input className="rk-input" required type="number" min="1" step="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} />
          {lines.length > 1 && <button type="button" className="rk-btn-outline" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>×</button>}
        </div>
      ))}</div>
      <div className="rk-actions-row">
        <button type="button" className="rk-btn-outline" onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}>{t("add_line")}</button>
        <button className="rk-btn" disabled={busy || branches.length < 2 || !parts.length}>{t("create_transfer_request")}</button>
      </div>
    </form>
  );
}

function TransferRow({ transfer, user, busy, run, t, devicePaired }) {
  const items = Array.isArray(transfer.items) ? transfer.items : [];
  const [receiving, setReceiving] = useState(false);
  const [receiptLines, setReceiptLines] = useState({});
  const [receiptNote, setReceiptNote] = useState("");
  const [shipmentReference, setShipmentReference] = useState(() => crypto.randomUUID());
  const [receiptReference, setReceiptReference] = useState(() => crypto.randomUUID());
  const employeeBranch = Number(user.branchId);
  const canShip = transfer.status === "requested" && (user.role === "admin" || employeeBranch === Number(transfer.source_branch_id));
  const canReceive = transfer.status === "in_transit" && (user.role === "admin" || employeeBranch === Number(transfer.destination_branch_id));

  async function ship() {
    if (await run(() => shipInventoryTransfer(transfer.id, shipmentReference), "transfer_shipped")) {
      setShipmentReference(crypto.randomUUID());
    }
  }

  async function receive() {
    const lines = items.map((item) => ({
      transferItemId: item.id,
      receivedQuantity: Number(receiptLines[item.id]?.received ?? item.shippedQuantity),
      damagedQuantity: Number(receiptLines[item.id]?.damaged || 0),
    }));
    if (await run(
      () => receiveInventoryTransfer(transfer.id, lines, receiptNote, receiptReference),
      "transfer_received"
    )) {
      setReceiving(false);
      setReceiptLines({});
      setReceiptNote("");
      setReceiptReference(crypto.randomUUID());
    }
  }

  return (
    <tr>
      <td><strong>{transfer.transfer_number}</strong><br /><small>{new Date(transfer.created_at).toLocaleDateString()}</small></td>
      <td>{transfer.source_branch_name} → {transfer.destination_branch_name}</td>
      <td><span className={`rk-badge ${STATUS_CLASS[transfer.status] || ""}`}>{t(`transfer_status_${transfer.status}`)}</span></td>
      <td>{items.map((item) => (
        <div key={item.id} className="rk-line-summary">
          <span>{item.partNumber} — {item.partName}</span>
          <strong>{item.receivedQuantity}/{item.shippedQuantity}/{item.requestedQuantity}</strong>
        </div>
      ))}</td>
      <td><div className="rk-actions-stack">
        {user.role === "admin" && transfer.status === "requested" && (
          <button className="rk-btn-outline" disabled={busy} onClick={() => run(() => cancelInventoryTransfer(transfer.id), "transfer_cancelled")}>{t("cancel")}</button>
        )}
        {canShip && <button className="rk-btn" disabled={busy || !devicePaired} onClick={ship}>{t("ship_transfer")}</button>}
        {canReceive && <button className="rk-btn-outline" disabled={busy || !devicePaired} onClick={() => setReceiving((value) => !value)}>{t("receive_transfer")}</button>}
        {(canShip || canReceive) && !devicePaired && <small className="rk-text-danger">{t("pair_device_for_transfer")}</small>}
        {receiving && <div className="rk-receipt-panel">
          {items.map((item) => (
            <div key={item.id} className="rk-transfer-receipt-line">
              <strong>{item.partNumber} ({t("shipped")}: {item.shippedQuantity})</strong>
              <label className="rk-field-label">{t("received_quantity")}<input className="rk-input" type="number" min="0" max={item.shippedQuantity} value={receiptLines[item.id]?.received ?? item.shippedQuantity} onChange={(event) => setReceiptLines({ ...receiptLines, [item.id]: { ...receiptLines[item.id], received: event.target.value } })} /></label>
              <label className="rk-field-label">{t("damaged_quantity")}<input className="rk-input" type="number" min="0" max={item.shippedQuantity} value={receiptLines[item.id]?.damaged || 0} onChange={(event) => setReceiptLines({ ...receiptLines, [item.id]: { ...receiptLines[item.id], damaged: event.target.value } })} /></label>
            </div>
          ))}
          <input className="rk-input" placeholder={t("variance_note")} value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} />
          <button className="rk-btn" disabled={busy} onClick={receive}>{t("confirm_receipt")}</button>
        </div>}
      </div></td>
    </tr>
  );
}
