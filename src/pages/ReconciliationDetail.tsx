import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  getClient,
  getReconciliationLineItems,
  resolveReconciliationRecord,
  bulkResolveReconciliationRecords,
  escalateReconciliationRecord,
  bulkCreateMissingInvoiceTasks,
  getCurrentStaffId,
  type ReconciliationLineItem,
} from '../lib/queries';
import { importGstr2bLineItems, runGstr2bReconciliation } from '../lib/gstr2b';

type FilterTab = 'all' | 'mismatch' | 'missing_in_tally' | 'missing_in_portal' | 'resolved' | 'matched';

const tabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'mismatch', label: 'Mismatch' },
  { key: 'missing_in_tally', label: 'Missing in Tally' },
  { key: 'missing_in_portal', label: 'Missing in portal' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'matched', label: 'Matched' },
];

const statusLabels: Record<string, string> = {
  matched: 'Matched',
  mismatch: 'Amount mismatch',
  missing_in_tally: 'Missing in Tally',
  missing_in_portal: 'Missing in portal',
  under_review: 'Under review',
  resolved: 'Resolved',
  escalated: 'Escalated',
};

export function ReconciliationDetail() {
  const { id: clientId } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const period = searchParams.get('period') ?? `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

  const [clientName, setClientName] = useState<string>('');
  const [items, setItems] = useState<ReconciliationLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState('');
  const [showBulkNoteInput, setShowBulkNoteInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    if (!clientId) return;
    setLoading(true);
    Promise.all([getClient(clientId), getReconciliationLineItems(clientId, period)])
      .then(([client, lineItems]) => {
        setClientName(client.legal_name);
        setItems(lineItems);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load reconciliation data.'))
      .finally(() => setLoading(false));
  }, [clientId, period]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (tab === 'all') return items.filter((i) => i.status !== 'matched');
    return items.filter((i) => i.status === tab);
  }, [items, tab]);

  async function handleResolve(id: string) {
    const note = noteDrafts[id]?.trim();
    if (!note) return;
    setBusy(true);
    try {
      const staffId = await getCurrentStaffId();
      if (!staffId) throw new Error('No signed-in staff account found.');
      await resolveReconciliationRecord(id, note, staffId);
      setExpandedId(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve.');
    } finally {
      setBusy(false);
    }
  }

  async function handleEscalate(id: string) {
    setBusy(true);
    try {
      await escalateReconciliationRecord(id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to escalate.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTask(item: ReconciliationLineItem) {
    if (!clientId) return;
    setBusy(true);
    try {
      await bulkCreateMissingInvoiceTasks(clientId, [item]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task.');
    } finally {
      setBusy(false);
    }
  }

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedItems = items.filter((i) => selected.has(i.id));
  const selectedMissingTally = selectedItems.filter((i) => i.status === 'missing_in_tally');

  async function handleBulkCreateTasks() {
    if (!clientId || selectedMissingTally.length === 0) return;
    setBusy(true);
    try {
      await bulkCreateMissingInvoiceTasks(clientId, selectedMissingTally);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tasks.');
    } finally {
      setBusy(false);
    }
  }

  async function handleBulkResolve() {
    if (!bulkNote.trim() || selectedItems.length === 0) return;
    setBusy(true);
    try {
      const staffId = await getCurrentStaffId();
      if (!staffId) throw new Error('No signed-in staff account found.');
      await bulkResolveReconciliationRecords(
        selectedItems.map((i) => i.id),
        bulkNote,
        staffId
      );
      setSelected(new Set());
      setBulkNote('');
      setShowBulkNoteInput(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve selected records.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    const file = fileInputRef.current?.files?.[0];
    if (!clientId || !file) return;
    setImportBusy(true);
    setImportResult(null);
    setError(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const staffId = await getCurrentStaffId();
      if (!staffId) throw new Error('No signed-in staff account found.');
      const importedCount = await importGstr2bLineItems(clientId, period, parsed, staffId);
      const result = await runGstr2bReconciliation(clientId, period);
      setImportResult(
        `Imported ${importedCount} line item${importedCount === 1 ? '' : 's'}. ` +
          `Matched ${result.matched_count} · Mismatch ${result.mismatch_count} · ` +
          `Missing in Tally ${result.missing_in_tally_count} · Missing in portal ${result.missing_in_portal_count}.`
      );
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setImportBusy(false);
    }
  }

  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <Link className="card__link" to="/tally/reconciliation">
        ← Reconciliation center
      </Link>

      <div className="content__header" style={{ marginTop: 8 }}>
        <h1 className="content__title">{loading ? 'Loading…' : clientName} — GSTR-2B vs Tally purchase</h1>
        <span className="mono" style={{ color: 'var(--ink-soft)', fontSize: 13 }}>
          {period}
        </span>
      </div>

      <div className="card invite-form">
        <h2 className="card__title" style={{ marginBottom: 'var(--space-2)', fontSize: 14 }}>
          Import GSTR-2B for {period}
        </h2>
        <p style={{ fontSize: 12, color: 'var(--ink-faint)', margin: '0 0 var(--space-3)' }}>
          Upload a JSON file: an array of {'{'}supplier_gstin, invoice_number, invoice_date, taxable_value,
          tax_amount{'}'}. This isn't the government portal's raw export format — map that to this shape first
          (see README). Re-uploading replaces the previous import for this period and re-runs matching against
          Tally purchase vouchers.
        </p>
        <div className="invite-form__row">
          <input ref={fileInputRef} type="file" accept="application/json" />
          <button className="btn-link" type="button" disabled={importBusy} onClick={handleImport}>
            {importBusy ? 'Importing…' : 'Import & reconcile'}
          </button>
        </div>
        {importResult && <p style={{ fontSize: 12, color: 'var(--good)', marginTop: 'var(--space-2)' }}>{importResult}</p>}
      </div>

      <div className="recon-tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`recon-tab${tab === t.key ? ' recon-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--bad)', marginBottom: 'var(--space-4)' }}>
          <p style={{ margin: 0, color: 'var(--bad)' }}>{error}</p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="bulk-bar">
          <span className="mono">{selected.size} selected</span>
          {selectedMissingTally.length > 0 && (
            <button className="btn-link" type="button" disabled={busy} onClick={handleBulkCreateTasks}>
              Create missing-invoice tasks ({selectedMissingTally.length})
            </button>
          )}
          {!showBulkNoteInput ? (
            <button className="btn-link" type="button" onClick={() => setShowBulkNoteInput(true)}>
              Mark resolved
            </button>
          ) : (
            <span className="bulk-bar__note">
              <input
                className="search-input"
                style={{ width: 240 }}
                placeholder="Resolution note (required)…"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
              />
              <button className="btn-link" type="button" disabled={busy || !bulkNote.trim()} onClick={handleBulkResolve}>
                Confirm
              </button>
            </span>
          )}
        </div>
      )}

      <div className="card">
        {loading ? (
          <>
            <div className="skeleton-line" style={{ width: '95%' }} />
            <div className="skeleton-line" style={{ width: '85%' }} />
          </>
        ) : filtered.length === 0 ? (
          <p className="card__empty">No records in this view.</p>
        ) : (
          <table className="recon-table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>Supplier GSTIN</th>
                <th>Invoice #</th>
                <th>Tally ₹</th>
                <th>Portal ₹</th>
                <th>Delta ₹</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <Fragment key={item.id}>
                  <tr className="recon-table__row">
                    <td>
                      {(item.status === 'mismatch' || item.status === 'missing_in_tally') && (
                        <input
                          type="checkbox"
                          checked={selected.has(item.id)}
                          onChange={() => toggleSelected(item.id)}
                          aria-label="Select row"
                        />
                      )}
                    </td>
                    <td className="mono">{item.supplier_gstin ?? '—'}</td>
                    <td className="mono">{item.invoice_number ?? '—'}</td>
                    <td className="mono">{item.tally_value != null ? item.tally_value.toLocaleString('en-IN') : '—'}</td>
                    <td className="mono">{item.portal_value != null ? item.portal_value.toLocaleString('en-IN') : '—'}</td>
                    <td className={`mono${(item.delta ?? 0) !== 0 ? ' recon-table__delta' : ''}`}>
                      {item.delta != null ? item.delta.toLocaleString('en-IN') : '—'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={`filing-timeline__status filing-timeline__status--${item.status === 'resolved' || item.status === 'matched' ? 'filed' : 'pending'}`}
                        style={{ border: 'none', cursor: 'pointer' }}
                        onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      >
                        {statusLabels[item.status] ?? item.status}
                      </button>
                    </td>
                  </tr>
                  {expandedId === item.id && (
                    <tr>
                      <td colSpan={7} className="recon-table__expand">
                        <div className="recon-expand">
                          <p className="recon-expand__meta">
                            Match confidence: GSTIN + invoice number, exact | Tolerance: ±₹1
                          </p>
                          {item.resolution_notes && (
                            <p className="recon-expand__meta">Note: {item.resolution_notes}</p>
                          )}
                          {item.status !== 'resolved' && item.status !== 'matched' && (
                            <div className="recon-expand__actions">
                              <input
                                className="search-input"
                                style={{ width: 320 }}
                                placeholder="Resolution note (required)…"
                                value={noteDrafts[item.id] ?? ''}
                                onChange={(e) => setNoteDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              />
                              <button
                                className="btn-link"
                                type="button"
                                disabled={busy || !(noteDrafts[item.id] ?? '').trim()}
                                onClick={() => handleResolve(item.id)}
                              >
                                Mark resolved
                              </button>
                              <button className="btn-link" type="button" disabled={busy} onClick={() => handleEscalate(item.id)}>
                                Escalate to client
                              </button>
                              {item.status === 'missing_in_tally' && (
                                <button className="btn-link" type="button" disabled={busy} onClick={() => handleCreateTask(item)}>
                                  Create task
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
