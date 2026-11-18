/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { SpreadsheetData } from '../types';
import { deduplicateHeaders } from './calculator';

// Initialize Firebase App for Auth & OAuth token retrieval
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/spreadsheets.readonly');
provider.addScope('https://www.googleapis.com/auth/drive.readonly');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else {
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string }> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve Google OAuth access token from authentication response.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Sign-In Error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const tokenResult = await currentUser.getIdTokenResult();
      if (tokenResult) {
        // Token active
      }
    } catch (e) {
      console.warn('Could not refresh token:', e);
    }
  }
  return cachedAccessToken;
};

export const googleSignOut = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};

export function extractSpreadsheetId(urlOrId: string): string {
  const clean = (urlOrId || '').trim();
  if (!clean) throw new Error('Spreadsheet URL or ID cannot be blank.');
  
  const match = clean.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  
  if (/^[a-zA-Z0-9-_]{15,}$/.test(clean)) {
    return clean;
  }
  
  throw new Error('Invalid Google Sheets URL or ID. Please paste a valid spreadsheet link (e.g. https://docs.google.com/spreadsheets/d/...)');
}

export type SyncStatusState =
  | 'Not Connected'
  | 'Connecting'
  | 'Fetching Spreadsheet'
  | 'Reading Sheet Data'
  | 'Processing Records'
  | 'Saving Records'
  | 'Sync Successful'
  | 'Sync Successful — No New Changes'
  | 'Sync Failed';

export interface SheetMetadata {
  spreadsheetId: string;
  title: string;
  sheets: { sheetId: number; title: string; rowCount: number; columnCount: number }[];
}

export async function fetchSpreadsheetMetadata(spreadsheetId: string, accessToken: string): Promise<SheetMetadata> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Authentication expired or permission denied. Please sign in again with a Google account that has access to this spreadsheet.');
    }
    if (res.status === 404) {
      throw new Error('Google Spreadsheet not found. Please verify the URL or ID and ensure sharing permissions allow access.');
    }
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Failed to fetch spreadsheet metadata (HTTP ${res.status}).`);
  }

  const data = await res.json();
  const title = data.properties?.title || 'Google Sheet';
  const sheets = (data.sheets || []).map((s: any) => ({
    sheetId: s.properties?.sheetId || 0,
    title: s.properties?.title || 'Sheet1',
    rowCount: s.properties?.gridProperties?.rowCount || 1000,
    columnCount: s.properties?.gridProperties?.columnCount || 26,
  }));

  return { spreadsheetId, title, sheets };
}

export async function fetchSheetValues(spreadsheetId: string, sheetTitle: string, accessToken: string): Promise<any[][]> {
  const range = encodeURIComponent(`'${sheetTitle}'!A1:ZZ5000`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error('Permission denied when reading sheet values. Check account access.');
    }
    const errJson = await res.json().catch(() => ({}));
    throw new Error(errJson.error?.message || `Failed to read sheet data (HTTP ${res.status}).`);
  }

  const data = await res.json();
  return data.values || [];
}

export function parseValuesToSpreadsheetData(
  title: string,
  sheetsMeta: { title: string }[],
  sheetValuesMap: Record<string, any[][]>
): SpreadsheetData {
  const worksheets = sheetsMeta.map((sheet) => {
    const rawValues = sheetValuesMap[sheet.title] || [];
    if (rawValues.length === 0) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const rawHeaders = (rawValues[0] || []).map((h: any) => String(h || '').trim());
    const validHeaders = rawHeaders.filter(Boolean);
    const headers = deduplicateHeaders(validHeaders);

    if (headers.length === 0 || rawValues.length <= 1) {
      return { name: sheet.title, headers: [], rows: [] };
    }

    const rows: Record<string, any>[] = [];
    for (let r = 1; r < rawValues.length; r++) {
      const rowVals = rawValues[r] || [];
      const rowObj: Record<string, any> = {};
      let hasData = false;

      headers.forEach((header, hIdx) => {
        const originalIdx = rawHeaders.indexOf(header);
        const val = originalIdx >= 0 ? rowVals[originalIdx] : rowVals[hIdx];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          hasData = true;
          rowObj[header] = val;
        } else {
          rowObj[header] = '';
        }
      });

      if (hasData) {
        rows.push(rowObj);
      }
    }

    return {
      name: sheet.title,
      headers,
      rows,
    };
  });

  const activeSheet = worksheets.find((w) => w.rows.length > 0)?.name || worksheets[0]?.name || 'Sheet1';

  return {
    fileName: `${title}.gsheet`,
    worksheets,
    activeSheetName: activeSheet,
  };
}
