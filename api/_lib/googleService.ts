/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import { google } from 'googleapis';
import {
  AppServerConfig,
  BASE_GOOGLE_SCOPES,
  getScopesForFeature,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_GMAIL_SEND_SCOPE,
  GOOGLE_SHEETS_SCOPE,
  GoogleOAuthFeature,
  hasDriveScope,
  hasGmailSendScope,
  hasSheetsScope,
} from './config.js';
import { generateRandomId } from './crypto.js';
import { GoogleDriveStore, PersistedSpreadsheetRecord } from './driveStore.js';
import { EncryptedSessionData } from './http.js';
import {
  buildSheetRange,
  computeSyncDiff,
  extractSpreadsheetId,
  NormalizedRowRecord,
  NormalizedWorksheet,
  normalizeSheetValues,
  SheetMetadataItem,
} from './sheetsNormalization.js';

export class HttpApiError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly requiresReauth: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    requiresReauth: boolean = false
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.requiresReauth = requiresReauth;
  }
}

export interface GoogleUserIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface TokenExchangeResult {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
  id_token?: string | null;
}

export interface GoogleTransportAdapter {
  exchangeAuthCode(params: {
    code: string;
    redirectUri: string;
    config: AppServerConfig;
  }): Promise<{
    tokens: TokenExchangeResult;
    identity: GoogleUserIdentity;
  }>;
  refreshAccessToken(params: {
    refreshToken: string;
    config: AppServerConfig;
  }): Promise<TokenExchangeResult>;
  revokeToken(token: string): Promise<void>;
  fetchSpreadsheetMetadata(params: {
    spreadsheetId: string;
    accessToken: string;
    config: AppServerConfig;
  }): Promise<{
    spreadsheetId: string;
    title: string;
    sheets: SheetMetadataItem[];
  }>;
  fetchSheetValues(params: {
    spreadsheetId: string;
    range: string;
    accessToken: string;
    config: AppServerConfig;
  }): Promise<any[][]>;
}

export function mapGoogleApiError(err: any, fallbackMessage: string): HttpApiError {
  if (err instanceof HttpApiError) return err;
  const status = err?.code || err?.status || err?.response?.status || 500;
  const apiMsg =
    err?.response?.data?.error_description ||
    err?.response?.data?.error?.message ||
    err?.errors?.[0]?.message ||
    err?.message ||
    fallbackMessage;
  const rawError = String(err?.response?.data?.error || err?.code || '');

  if (rawError === 'invalid_grant' || /invalid_grant|token has been expired or revoked/i.test(apiMsg)) {
    return new HttpApiError(
      401,
      'GOOGLE_REAUTH_REQUIRED',
      'Google authorization expired or was revoked. Please sign in with Google again.',
      true
    );
  }
  if (status === 401) {
    return new HttpApiError(
      401,
      'GOOGLE_UNAUTHORIZED',
      'Google authentication expired or is invalid. Please sign in with Google again.',
      true
    );
  }
  if (status === 403) {
    return new HttpApiError(
      403,
      'GOOGLE_PERMISSION_DENIED',
      `Permission denied by Google API: ${apiMsg}. Ensure the required Google permission is granted and the file is accessible to your signed-in account.`
    );
  }
  if (status === 404) {
    return new HttpApiError(
      404,
      'GOOGLE_RESOURCE_NOT_FOUND',
      'Requested Google resource was not found. Verify the URL or ID and check sharing access.'
    );
  }
  if (status === 429) {
    return new HttpApiError(
      429,
      'GOOGLE_RATE_LIMITED',
      'Google API rate limit exceeded. Wait a few seconds and try again.'
    );
  }
  if (status === 400) {
    return new HttpApiError(400, 'BAD_GOOGLE_REQUEST', apiMsg);
  }

  return new HttpApiError(
    typeof status === 'number' && status >= 400 && status < 600 ? status : 502,
    'GOOGLE_API_ERROR',
    apiMsg || fallbackMessage
  );
}

export const defaultGoogleTransport: GoogleTransportAdapter = {
  async exchangeAuthCode({ code, redirectUri, config }) {
    const client = new OAuth2Client(
      config.googleClientId,
      config.googleClientSecret,
      redirectUri
    );
    try {
      const { tokens } = await client.getToken({
        code,
        redirect_uri: redirectUri,
      });

      let identity: GoogleUserIdentity | null = null;
      if (tokens.id_token) {
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token,
          audience: config.googleClientId,
        });
        const payload = ticket.getPayload();
        if (payload?.sub && payload?.email) {
          identity = {
            sub: payload.sub,
            email: payload.email,
            name: payload.name || null,
            picture: payload.picture || null,
          };
        }
      }

      if (!identity && tokens.access_token) {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (userRes.ok) {
          const userInfo: any = await userRes.json();
          if (userInfo?.sub && userInfo?.email) {
            identity = {
              sub: userInfo.sub,
              email: userInfo.email,
              name: userInfo.name || null,
              picture: userInfo.picture || null,
            };
          }
        }
      }

      if (!identity) {
        throw new HttpApiError(
          401,
          'IDENTITY_VERIFICATION_FAILED',
          'Google authentication succeeded but user identity could not be verified.'
        );
      }

      return { tokens, identity };
    } catch (err: any) {
      if (err instanceof HttpApiError) throw err;
      throw mapGoogleApiError(err, 'Failed to exchange Google authorization code.');
    }
  },

  async refreshAccessToken({ refreshToken, config }) {
    const client = new OAuth2Client(config.googleClientId, config.googleClientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    try {
      const { credentials } = await client.refreshAccessToken();
      return credentials;
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Failed to refresh Google access token.');
    }
  },

  async revokeToken(token: string) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // Best-effort revocation; local cookie clearing always proceeds
    }
  },

  async fetchSpreadsheetMetadata({ spreadsheetId, accessToken, config }) {
    const auth = new OAuth2Client(config.googleClientId, config.googleClientSecret);
    auth.setCredentials({ access_token: accessToken });
    const sheetsApi = google.sheets({ version: 'v4', auth });
    try {
      const response = await sheetsApi.spreadsheets.get({
        spreadsheetId,
        fields: 'spreadsheetId,properties.title,sheets.properties(sheetId,title,index,gridProperties)',
      });
      const data = response.data;
      const sheets: SheetMetadataItem[] = (data.sheets || []).map((s, idx) => ({
        sheetId: s.properties?.sheetId ?? idx,
        title: s.properties?.title || `Sheet${idx + 1}`,
        index: s.properties?.index ?? idx,
        rowCount: s.properties?.gridProperties?.rowCount ?? 1000,
        columnCount: s.properties?.gridProperties?.columnCount ?? 26,
      }));
      return {
        spreadsheetId: data.spreadsheetId || spreadsheetId,
        title: data.properties?.title || 'Untitled Google Sheet',
        sheets,
      };
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Failed to retrieve spreadsheet metadata.');
    }
  },

  async fetchSheetValues({ spreadsheetId, range, accessToken, config }) {
    const auth = new OAuth2Client(config.googleClientId, config.googleClientSecret);
    auth.setCredentials({ access_token: accessToken });
    const sheetsApi = google.sheets({ version: 'v4', auth });
    try {
      const response = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range,
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      });
      return (response.data.values as any[][]) || [];
    } catch (err: any) {
      throw mapGoogleApiError(err, 'Failed to retrieve worksheet cell values.');
    }
  },
};

export function assertGoogleOAuthConfig(config: AppServerConfig): void {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new HttpApiError(
      503,
      'GOOGLE_OAUTH_UNCONFIGURED',
      'Google OAuth backend credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured on the server.'
    );
  }
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    throw new HttpApiError(
      503,
      'SESSION_SECRET_UNCONFIGURED',
      'Server SESSION_SECRET is missing or too short (minimum 16 characters).'
    );
  }
  if (!config.tokenEncryptionKey || config.tokenEncryptionKey.length < 16) {
    throw new HttpApiError(
      503,
      'ENCRYPTION_KEY_UNCONFIGURED',
      'Server TOKEN_ENCRYPTION_KEY is missing or too short (minimum 16 characters).'
    );
  }
}

export function normalizeOAuthFeature(raw?: string | null): GoogleOAuthFeature {
  const val = String(raw || 'signin').toLowerCase().trim();
  if (val === 'drive' || val === 'sheets' || val === 'gmail') return val;
  return 'signin';
}

export function buildGoogleAuthorizeUrl(
  config: AppServerConfig,
  state: string,
  feature: GoogleOAuthFeature = 'signin',
  existingScopes: string[] = []
): string {
  assertGoogleOAuthConfig(config);
  const client = new OAuth2Client(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
  );
  const scopes = getScopesForFeature(feature, existingScopes);
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: scopes,
    state,
  });
}

export async function completeOAuthCodeExchange(params: {
  code: string;
  redirectUri: string;
  feature?: GoogleOAuthFeature;
  existingSession?: EncryptedSessionData | null;
  config: AppServerConfig;
  transport?: GoogleTransportAdapter;
}): Promise<{
  session: EncryptedSessionData;
  scopes: string[];
}> {
  assertGoogleOAuthConfig(params.config);
  const transport = params.transport || defaultGoogleTransport;
  const feature = params.feature || 'signin';

  if (!params.code || !params.code.trim()) {
    throw new HttpApiError(400, 'MISSING_AUTH_CODE', 'Authorization code is required.');
  }

  const { tokens, identity } = await transport.exchangeAuthCode({
    code: params.code.trim(),
    redirectUri: params.redirectUri,
    config: params.config,
  });

  if (!tokens.access_token) {
    throw new HttpApiError(
      502,
      'MISSING_ACCESS_TOKEN',
      'Google OAuth response did not include an access token.'
    );
  }

  // Only merge existing scopes/refreshToken if the signed-in Google sub matches the existing session!
  const isSameAccount = params.existingSession && params.existingSession.uid === identity.sub;
  const existingScopes = isSameAccount
    ? params.existingSession!.sc.split(/\s+/).filter(Boolean)
    : [];
  const returnedScopes = (tokens.scope || getScopesForFeature(feature).join(' '))
    .split(/\s+/)
    .filter(Boolean);

  const mergedScopes = Array.from(
    new Set([...BASE_GOOGLE_SCOPES, ...existingScopes, ...returnedScopes])
  );

  if (feature === 'sheets' && !hasSheetsScope(returnedScopes) && !hasSheetsScope(mergedScopes)) {
    throw new HttpApiError(
      403,
      'SHEETS_SCOPE_REQUIRED',
      'Google Sheets read permission was not granted. Please authorize Google Sheets access.'
    );
  }
  if (feature === 'drive' && !hasDriveScope(returnedScopes) && !hasDriveScope(mergedScopes)) {
    throw new HttpApiError(
      403,
      'DRIVE_SCOPE_REQUIRED',
      'Google Drive storage permission (drive.file) was not granted. Please approve Google Drive access.'
    );
  }
  if (feature === 'gmail' && !hasGmailSendScope(returnedScopes) && !hasGmailSendScope(mergedScopes)) {
    throw new HttpApiError(
      403,
      'GMAIL_SCOPE_REQUIRED',
      'Gmail send permission (gmail.send) was not granted. Please approve Gmail send access.'
    );
  }

  const refreshToken = tokens.refresh_token || (isSameAccount ? params.existingSession!.rt : null);
  const expiresAtMs = tokens.expiry_date || Date.now() + 3500 * 1000;

  const session: EncryptedSessionData = {
    uid: identity.sub,
    em: identity.email,
    nm: identity.name,
    pic: identity.picture,
    sc: mergedScopes.join(' '),
    rt: refreshToken,
    at: tokens.access_token,
    exp: expiresAtMs,
    df: isSameAccount ? params.existingSession!.df || null : null,
    cat: isSameAccount ? params.existingSession!.cat || new Date().toISOString() : new Date().toISOString(),
  };

  return { session, scopes: mergedScopes };
}

export async function ensureFreshAccessToken(params: {
  session: EncryptedSessionData;
  requiredFeature?: 'drive' | 'sheets' | 'gmail';
  config: AppServerConfig;
  transport?: GoogleTransportAdapter;
  forceRefresh?: boolean;
}): Promise<{ accessToken: string; session: EncryptedSessionData; refreshed: boolean }> {
  assertGoogleOAuthConfig(params.config);
  const transport = params.transport || defaultGoogleTransport;
  const grantedScopes = params.session.sc.split(/\s+/).filter(Boolean);

  if (params.requiredFeature === 'drive' && !hasDriveScope(grantedScopes)) {
    throw new HttpApiError(
      403,
      'DRIVE_SCOPE_REQUIRED',
      'Google Drive storage permission (drive.file) is required. Reconnect Google Drive in Account Settings.'
    );
  }
  if (params.requiredFeature === 'sheets' && !hasSheetsScope(grantedScopes)) {
    throw new HttpApiError(
      403,
      'SHEETS_SCOPE_REQUIRED',
      'Google Sheets read permission is not authorized yet. Click Connect Google Sheets first.'
    );
  }
  if (params.requiredFeature === 'gmail' && !hasGmailSendScope(grantedScopes)) {
    throw new HttpApiError(
      403,
      'GMAIL_SCOPE_REQUIRED',
      'Gmail sending permission is not authorized yet. Connect Gmail in Account & Email Settings.'
    );
  }

  const needsRefresh =
    Boolean(params.forceRefresh) ||
    !params.session.at ||
    !params.session.exp ||
    params.session.exp - Date.now() < 90 * 1000;

  if (!needsRefresh && params.session.at) {
    return { accessToken: params.session.at, session: params.session, refreshed: false };
  }

  if (!params.session.rt) {
    throw new HttpApiError(
      401,
      'GOOGLE_REAUTH_REQUIRED',
      'Google session expired and no refresh token is available. Please sign in with Google again.',
      true
    );
  }

  const refreshedTokens = await transport.refreshAccessToken({
    refreshToken: params.session.rt,
    config: params.config,
  });

  if (!refreshedTokens.access_token) {
    throw new HttpApiError(
      401,
      'GOOGLE_REAUTH_REQUIRED',
      'Google failed to issue a fresh access token. Please sign in with Google again.',
      true
    );
  }

  const updatedSession: EncryptedSessionData = {
    ...params.session,
    at: refreshedTokens.access_token,
    rt: refreshedTokens.refresh_token || params.session.rt,
    exp: refreshedTokens.expiry_date || Date.now() + 3500 * 1000,
  };

  return {
    accessToken: refreshedTokens.access_token,
    session: updatedSession,
    refreshed: true,
  };
}

export async function runWithSessionTokenRetry<T>(
  params: {
    session: EncryptedSessionData;
    requiredFeature?: 'drive' | 'sheets' | 'gmail';
    config: AppServerConfig;
    transport?: GoogleTransportAdapter;
    onSessionUpdated?: (next: EncryptedSessionData) => void;
  },
  fn: (accessToken: string, session: EncryptedSessionData) => Promise<T>
): Promise<T> {
  const first = await ensureFreshAccessToken(params);
  if (first.refreshed) {
    params.onSessionUpdated?.(first.session);
  }
  try {
    return await fn(first.accessToken, first.session);
  } catch (err: any) {
    if (err instanceof HttpApiError && err.statusCode === 401 && first.session.rt) {
      const retry = await ensureFreshAccessToken({
        ...params,
        session: first.session,
        forceRefresh: true,
      });
      params.onSessionUpdated?.(retry.session);
      return await fn(retry.accessToken, retry.session);
    }
    throw err;
  }
}

export function stripFeatureScopeFromSession(
  session: EncryptedSessionData,
  feature: 'drive' | 'sheets' | 'gmail'
): EncryptedSessionData {
  const scopeList = session.sc.split(/\s+/).filter(Boolean);
  const filtered = scopeList.filter((s) => {
    if (feature === 'drive') {
      return s !== GOOGLE_DRIVE_SCOPE && s !== 'https://www.googleapis.com/auth/drive';
    }
    if (feature === 'sheets') {
      return s !== GOOGLE_SHEETS_SCOPE && s !== 'https://www.googleapis.com/auth/spreadsheets';
    }
    if (feature === 'gmail') {
      return (
        s !== GOOGLE_GMAIL_SEND_SCOPE &&
        s !== 'https://mail.google.com/' &&
        s !== 'https://www.googleapis.com/auth/gmail.compose'
      );
    }
    return true;
  });
  return { ...session, sc: filtered.join(' ') };
}

export async function validateAndFetchSpreadsheetMetadata(params: {
  session: EncryptedSessionData;
  spreadsheetUrl: string;
  config: AppServerConfig;
  transport?: GoogleTransportAdapter;
  onSessionUpdated?: (next: EncryptedSessionData) => void;
}): Promise<{
  spreadsheetId: string;
  title: string;
  sheets: SheetMetadataItem[];
}> {
  const transport = params.transport || defaultGoogleTransport;
  const spreadsheetId = extractSpreadsheetId(params.spreadsheetUrl);

  const meta = await runWithSessionTokenRetry(
    {
      session: params.session,
      requiredFeature: 'sheets',
      config: params.config,
      transport,
      onSessionUpdated: params.onSessionUpdated,
    },
    (accessToken) =>
      transport.fetchSpreadsheetMetadata({
        spreadsheetId,
        accessToken,
        config: params.config,
      })
  );

  if (!meta.sheets || meta.sheets.length === 0) {
    throw new HttpApiError(
      422,
      'EMPTY_SPREADSHEET',
      'This Google Spreadsheet has no worksheets or tabs.'
    );
  }

  return meta;
}

async function fetchAllSheetRows(params: {
  spreadsheetId: string;
  sheetMeta: SheetMetadataItem;
  customRange?: string;
  accessToken: string;
  config: AppServerConfig;
  transport: GoogleTransportAdapter;
}): Promise<{ values: any[][]; rangeUsed: string }> {
  if (params.customRange && params.customRange.trim()) {
    const rangeUsed = buildSheetRange(params.sheetMeta.title, params.customRange.trim());
    const values = await params.transport.fetchSheetValues({
      spreadsheetId: params.spreadsheetId,
      range: rangeUsed,
      accessToken: params.accessToken,
      config: params.config,
    });
    return { values, rangeUsed };
  }

  const maxRows = Math.max(1000, params.sheetMeta.rowCount || 1000);
  const pageSize = 4000;
  const escapedTitle = params.sheetMeta.title.replace(/'/g, "''");

  if (maxRows <= pageSize) {
    const rangeUsed = buildSheetRange(params.sheetMeta.title, undefined, maxRows);
    const values = await params.transport.fetchSheetValues({
      spreadsheetId: params.spreadsheetId,
      range: rangeUsed,
      accessToken: params.accessToken,
      config: params.config,
    });
    return { values, rangeUsed };
  }

  const combinedValues: any[][] = [];
  let startRow = 1;
  while (startRow <= maxRows) {
    const endRow = Math.min(startRow + pageSize - 1, maxRows);
    const chunkRange = `'${escapedTitle}'!A${startRow}:ZZ${endRow}`;
    const chunk = await params.transport.fetchSheetValues({
      spreadsheetId: params.spreadsheetId,
      range: chunkRange,
      accessToken: params.accessToken,
      config: params.config,
    });

    if (!chunk || chunk.length === 0) {
      break;
    }

    combinedValues.push(...chunk);
    if (chunk.length < pageSize && endRow < maxRows) {
      break;
    }
    startRow = endRow + 1;
  }

  return {
    values: combinedValues,
    rangeUsed: `'${escapedTitle}'!A1:ZZ${maxRows}`,
  };
}

export async function performSpreadsheetSync(params: {
  session: EncryptedSessionData;
  spreadsheetUrl: string;
  sheetName?: string;
  range?: string;
  headerRowIndex?: number | 'auto';
  syncAllSheets?: boolean;
  config: AppServerConfig;
  driveStore: GoogleDriveStore | null;
  transport?: GoogleTransportAdapter;
  onSessionUpdated?: (next: EncryptedSessionData) => void;
}): Promise<PersistedSpreadsheetRecord> {
  const transport = params.transport || defaultGoogleTransport;
  const spreadsheetId = extractSpreadsheetId(params.spreadsheetUrl);
  const logId = `sync_${Date.now()}_${generateRandomId(6)}`;

  let currentSession = params.session;
  const handleSessionUpdate = (next: EncryptedSessionData) => {
    currentSession = next;
    params.onSessionUpdated?.(next);
  };

  let spreadsheetTitle = '';
  const selectedSheetInput = (params.sheetName || '').trim();

  try {
    const metadata = await runWithSessionTokenRetry(
      {
        session: currentSession,
        requiredFeature: 'sheets',
        config: params.config,
        transport,
        onSessionUpdated: handleSessionUpdate,
      },
      (accessToken) =>
        transport.fetchSpreadsheetMetadata({
          spreadsheetId,
          accessToken,
          config: params.config,
        })
    );

    spreadsheetTitle = metadata.title;
    if (!metadata.sheets || metadata.sheets.length === 0) {
      throw new HttpApiError(
        422,
        'EMPTY_SPREADSHEET',
        'Connected Google Spreadsheet contains no worksheet tabs.'
      );
    }

    const sheetsToFetch: SheetMetadataItem[] = params.syncAllSheets
      ? metadata.sheets
      : selectedSheetInput
      ? metadata.sheets.filter((s) => s.title === selectedSheetInput)
      : [metadata.sheets[0]];

    if (sheetsToFetch.length === 0) {
      throw new HttpApiError(
        400,
        'SHEET_TAB_NOT_FOUND',
        `Worksheet tab "${selectedSheetInput}" does not exist in "${metadata.title}".`
      );
    }

    const worksheets: NormalizedWorksheet[] = [];
    const syncedRowRecords: Array<{ sheetName: string; records: NormalizedRowRecord[] }> = [];
    let totalRetrieved = 0;
    let totalSkipped = 0;

    for (const sheetMeta of sheetsToFetch) {
      const useCustomRange =
        !params.syncAllSheets || sheetMeta.title === selectedSheetInput ? params.range : undefined;

      const { values, rangeUsed } = await runWithSessionTokenRetry(
        {
          session: currentSession,
          requiredFeature: 'sheets',
          config: params.config,
          transport,
          onSessionUpdated: handleSessionUpdate,
        },
        (accessToken) =>
          fetchAllSheetRows({
            spreadsheetId,
            sheetMeta,
            customRange: useCustomRange,
            accessToken,
            config: params.config,
            transport,
          })
      );

      const normalized = normalizeSheetValues(sheetMeta.title, values, {
        headerRowIndex: params.headerRowIndex,
        rangeUsed,
      });

      totalRetrieved += normalized.rowRecords.length;
      totalSkipped += normalized.worksheet.skippedEmptyRows;
      worksheets.push(normalized.worksheet);
      syncedRowRecords.push({
        sheetName: sheetMeta.title,
        records: normalized.rowRecords,
      });
    }

    const totalValidRows = worksheets.reduce((acc, w) => acc + w.rows.length, 0);
    if (totalValidRows === 0) {
      const errMsg =
        'Google Sheet was reached, but 0 valid data rows were found in the selected sheet/range. Check the selected worksheet tab, range, and header row.';
      if (params.driveStore) {
        await params.driveStore.recordSyncFailureLog({
          logId,
          spreadsheetId,
          spreadsheetTitle,
          sheetName: sheetsToFetch[0]?.title || '',
          errorMessage: errMsg,
        });
      }
      throw new HttpApiError(422, 'NO_ROWS_IMPORTED', errMsg);
    }

    const existingHashes = params.driveStore
      ? await params.driveStore.getRowHashesForSpreadsheet(spreadsheetId)
      : new Map<string, string>();

    const incomingForDiff = syncedRowRecords.flatMap((group) =>
      group.records.map((rec) => ({
        compositeKey: `${params.session.uid}::${spreadsheetId}::${group.sheetName}::${rec.rowKey}`,
        rowHash: rec.rowHash,
      }))
    );

    const stats = computeSyncDiff(existingHashes, incomingForDiff, totalRetrieved, totalSkipped);
    const hasChanges =
      existingHashes.size === 0 ||
      stats.createdCount > 0 ||
      stats.updatedCount > 0 ||
      stats.deletedCount > 0;
    const syncStatus: 'synced' | 'no_changes' = hasChanges ? 'synced' : 'no_changes';

    const activeSheetName =
      worksheets.find((w) => w.name === selectedSheetInput && w.rows.length > 0)?.name ||
      worksheets.find((w) => w.rows.length > 0)?.name ||
      worksheets[0]?.name ||
      '';

    if (params.driveStore) {
      return await params.driveStore.saveSyncedSpreadsheetTransaction({
        spreadsheetId,
        spreadsheetUrl: params.spreadsheetUrl,
        title: metadata.title,
        selectedSheetName: activeSheetName,
        selectedRange: (params.range || '').trim(),
        headerRowIndex:
          typeof params.headerRowIndex === 'number' && params.headerRowIndex >= 0
            ? params.headerRowIndex
            : worksheets[0]?.headerRowIndex ?? 0,
        sheetsMeta: metadata.sheets,
        worksheets,
        syncedRowRecords,
        stats,
        syncStatus,
        logId,
      });
    }

    return {
      id: `${params.session.uid}::${spreadsheetId}`,
      userId: params.session.uid,
      spreadsheetId,
      spreadsheetUrl: params.spreadsheetUrl,
      title: metadata.title,
      selectedSheetName: activeSheetName,
      selectedRange: (params.range || '').trim(),
      headerRowIndex:
        typeof params.headerRowIndex === 'number' && params.headerRowIndex >= 0
          ? params.headerRowIndex
          : worksheets[0]?.headerRowIndex ?? 0,
      sheetsMeta: metadata.sheets,
      worksheets,
      totalRows: totalValidRows,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: syncStatus,
      lastSyncStats: stats,
    };
  } catch (err: any) {
    const wrapped =
      err instanceof HttpApiError
        ? err
        : mapGoogleApiError(err, 'Google Sheets synchronization failed.');
    if (params.driveStore) {
      await params.driveStore.recordSyncFailureLog({
        logId,
        spreadsheetId,
        spreadsheetTitle,
        sheetName: selectedSheetInput,
        errorMessage: wrapped.message,
      });
    }
    throw wrapped;
  }
}
