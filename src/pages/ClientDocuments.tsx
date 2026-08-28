import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import {
  listDocuments,
  uploadDocument,
  getDocumentSignedUrl,
  deleteDocument,
  fileNameFromPath,
  type DocumentRow,
  type DocumentCategory,
} from '../lib/documents';

const categoryLabels: Record<DocumentCategory, string> = {
  pan: 'PAN',
  aadhaar: 'Aadhaar',
  bank_statement: 'Bank statement',
  financials: 'Financials',
  audit_report: 'Audit report',
  other: 'Other',
};

export function ClientDocuments() {
  const { id: clientId } = useParams<{ id: string }>();
  const { staff } = useAuth();
  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<DocumentCategory>('other');
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    if (!clientId) return;
    setLoading(true);
    listDocuments(clientId)
      .then(setDocs)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load documents.'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [clientId]);

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!clientId || !file || !staff) return;
    setUploading(true);
    setError(null);
    try {
      await uploadDocument(clientId, category, file, staff.id);
      if (fileInputRef.current) fileInputRef.current.value = '';
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(doc: DocumentRow) {
    try {
      const url = await getDocumentSignedUrl(doc.storage_path);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate download link.');
    }
  }

  async function handleDelete(doc: DocumentRow) {
    setBusyId(doc.id);
    try {
      await deleteDocument(doc.id, doc.storage_path);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete document.');
    } finally {
      setBusyId(null);
    }
  }

  const canDelete = staff && ['admin', 'partner', 'audit_manager'].includes(staff.role);

  return (
    <>
      <form className="card invite-form" onSubmit={handleUpload}>
        <h2 className="card__title" style={{ marginBottom: 'var(--space-3)' }}>
          Upload a document
        </h2>
        <div className="invite-form__row">
          <select
            className="search-input"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            {Object.entries(categoryLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input ref={fileInputRef} type="file" required />
          <button className="btn-link" type="submit" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
        {error && <p style={{ color: 'var(--bad)', fontSize: 13, marginTop: 'var(--space-2)' }}>{error}</p>}
      </form>

      <div className="card">
        {loading ? (
          <>
            <div className="skeleton-line" style={{ width: '90%' }} />
            <div className="skeleton-line" style={{ width: '75%' }} />
          </>
        ) : docs.length === 0 ? (
          <p className="card__empty">No documents uploaded yet.</p>
        ) : (
          <table className="client-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Category</th>
                <th>Version</th>
                <th>Uploaded</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>{fileNameFromPath(doc.storage_path)}</td>
                  <td>{categoryLabels[doc.category]}</td>
                  <td className="mono">v{doc.version}</td>
                  <td className="mono" style={{ fontSize: 12, color: 'var(--ink-faint)' }}>
                    {new Date(doc.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td>
                    <button className="btn-link" type="button" onClick={() => handleDownload(doc)} style={{ marginRight: 12 }}>
                      Download
                    </button>
                    {canDelete && (
                      <button
                        className="btn-link"
                        type="button"
                        disabled={busyId === doc.id}
                        onClick={() => handleDelete(doc)}
                        style={{ color: 'var(--bad)' }}
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
