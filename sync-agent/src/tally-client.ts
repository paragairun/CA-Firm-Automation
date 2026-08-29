// Talks to Tally Prime's XML/HTTP gateway (default port 9000), per spec §3.
//
// CONFIDENCE LEVEL — please read before relying on this in production:
// The request envelope shape (ENVELOPE/HEADER/BODY/EXPORTDATA/REQUESTDESC
// /REPORTNAME/STATICVARIABLES) is long-standing, well-documented Tally
// behavior and is reasonably safe to trust. The exact XML tags Tally
// returns for a given report, however, vary by Tally version and — more
// importantly — by whatever TDL report definition is actually being
// exported. The parsing functions below are a best-effort mapping based
// on commonly-documented conventions, NOT verified against a live Tally
// instance (none was available to test against while building this).
// Treat parseLedgerXml/parseVoucherXml as the first place to look if
// synced data comes back empty or wrong, and expect to adjust them
// against your actual Tally installation's output. For reliable
// machine-readable export at real scale, the standard practice is a
// custom TDL report definition designed for XML export rather than
// relying on a default report meant for on-screen display — this client
// currently requests Tally's default "Trial Balance" and "Day Book"
// reports, which is a reasonable starting point, not a guarantee.

import { XMLParser } from 'fast-xml-parser';
import type { LedgerRecord, VoucherRecord } from './types.js';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function buildExportRequest(reportName: string, companyName: string, extraVars: Record<string, string> = {}): string {
  const staticVars = Object.entries({ SVCURRENTCOMPANY: companyName, ...extraVars })
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join('');
  return `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>${escapeXml(reportName)}</REPORTNAME>
        <STATICVARIABLES>${staticVars}</STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function postToTally(endpoint: string, xml: string): Promise<string> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
  });
  if (!res.ok) {
    throw new Error(`Tally gateway returned HTTP ${res.status}`);
  }
  return res.text();
}

// Coerces Tally's inconsistent "one item vs array of items" XML-to-JSON
// shape (fast-xml-parser gives a bare object for a single match, an array
// for multiple) into always-an-array.
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBalance(raw: unknown): { value: number; type: 'dr' | 'cr' } {
  const str = String(raw ?? '0').trim();
  const negative = str.startsWith('-');
  const num = Math.abs(parseFloat(str) || 0);
  // Tally convention: negative closing balance in XML export commonly
  // indicates a credit balance for this ledger — this is the part most
  // worth double-checking against real output (see file header).
  return { value: num, type: negative ? 'cr' : 'dr' };
}

export async function fetchLedgers(endpoint: string, companyName: string): Promise<LedgerRecord[]> {
  const xml = buildExportRequest('Trial Balance', companyName);
  const responseXml = await postToTally(endpoint, xml);
  const parsed = parser.parse(responseXml);

  const ledgerNodes = asArray(
    parsed?.ENVELOPE?.DSPACCNAME ?? parsed?.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER
  );

  return ledgerNodes
    .map((node: Record<string, unknown>): LedgerRecord | null => {
      const name = String(node.LEDGERNAME ?? node['@_NAME'] ?? node.NAME ?? '').trim();
      if (!name) return null;
      const closing = parseBalance(node.CLOSINGBALANCE);
      const opening = parseBalance(node.OPENINGBALANCE ?? 0);
      return {
        ledger_name: name,
        ledger_group: node.PARENT ? String(node.PARENT) : undefined,
        opening_balance: opening.value,
        closing_balance: closing.value,
        balance_type: closing.type,
      };
    })
    .filter((r: LedgerRecord | null): r is LedgerRecord => r !== null);
}

export async function fetchPurchaseVouchers(
  endpoint: string,
  companyName: string,
  fromDate: string, // DD-MMM-YYYY, Tally's expected format
  toDate: string
): Promise<VoucherRecord[]> {
  const xml = buildExportRequest('Day Book', companyName, { SVFROMDATE: fromDate, SVTODATE: toDate });
  const responseXml = await postToTally(endpoint, xml);
  const parsed = parser.parse(responseXml);

  const voucherNodes = asArray(parsed?.ENVELOPE?.BODY?.DATA?.TALLYMESSAGE)
    .map((msg: Record<string, unknown>) => msg.VOUCHER)
    .filter((v: unknown): v is Record<string, unknown> => !!v);

  return voucherNodes
    .filter((v) => String(v['@_VCHTYPE'] ?? v.VOUCHERTYPENAME ?? '').toLowerCase().includes('purchase'))
    .map((v): VoucherRecord | null => {
      const voucherNumber = String(v.VOUCHERNUMBER ?? '').trim();
      const rawDate = String(v.DATE ?? '');
      if (!voucherNumber || !rawDate) return null;
      const entries = asArray(v['ALLLEDGERENTRIES.LIST']);
      const amount =
        entries.reduce((sum: number, e) => sum + Math.abs(parseFloat(String((e as Record<string, unknown>).AMOUNT ?? '0')) || 0), 0) / 2;
      const partyLedger = entries[0] ? String((entries[0] as Record<string, unknown>).LEDGERNAME ?? '') : undefined;
      return {
        voucher_type: 'purchase',
        voucher_number: voucherNumber,
        voucher_date: tallyDateToIso(rawDate),
        amount,
        party_ledger: partyLedger,
      };
    })
    .filter((r): r is VoucherRecord => r !== null);
}

// Tally exports dates as YYYYMMDD in most XML contexts (e.g. "20260731").
function tallyDateToIso(tallyDate: string): string {
  const digits = tallyDate.replace(/\D/g, '');
  if (digits.length !== 8) return tallyDate; // pass through unrecognized formats rather than guess
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}
