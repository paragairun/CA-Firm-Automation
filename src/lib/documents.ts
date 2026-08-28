import { supabase } from './supabaseClient';

export type DocumentCategory = 'pan' | 'aadhaar' | 'bank_statement' | 'financials' | 'audit_report' | 'other';

export interface DocumentRow {
  id: string;
  client_id: string;
  category: DocumentCategory;
  storage_path: string;
  version: number;
  uploaded_by: string | null;
  created_at: string;
}

const BUCKET = 'client-documents';

export async function listDocuments(clientId: string): Promise<DocumentRow[]> {
  const { data, error } = await supabase
    .from('documents')
    .select('id, client_id, category, storage_path, version, uploaded_by, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data as DocumentRow[];
}

export async function uploadDocument(
  clientId: string,
  category: DocumentCategory,
  file: File,
  uploadedBy: string
): Promise<DocumentRow> {
  const path = `${clientId}/${category}/${Date.now()}-${file.name}`;

  const { error: uploadErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadErr) throw uploadErr;

  const { data, error: insertErr } = await supabase
    .from('documents')
    .insert({
      client_id: clientId,
      category,
      storage_path: path,
      version: 1,
      uploaded_by: uploadedBy,
      audit_trail: [{ action: 'uploaded', by: uploadedBy, at: new Date().toISOString() }],
    })
    .select('id, client_id, category, storage_path, version, uploaded_by, created_at')
    .single();

  if (insertErr) {
    // Best-effort cleanup so a failed row insert doesn't leave an orphaned
    // file with no database record pointing at it.
    await supabase.storage.from(BUCKET).remove([path]);
    throw insertErr;
  }
  return data as DocumentRow;
}

export async function getDocumentSignedUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteDocument(id: string, storagePath: string): Promise<void> {
  const { error: storageErr } = await supabase.storage.from(BUCKET).remove([storagePath]);
  if (storageErr) throw storageErr;
  const { error: dbErr } = await supabase.from('documents').delete().eq('id', id);
  if (dbErr) throw dbErr;
}

export function fileNameFromPath(path: string): string {
  const last = path.split('/').pop() ?? path;
  // Strip the "<timestamp>-" prefix added at upload time for display.
  return last.replace(/^\d+-/, '');
}
