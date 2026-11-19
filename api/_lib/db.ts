/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import pg from 'pg';
import {
  NormalizedRowRecord,
  NormalizedWorksheet,
  SheetMetadataItem,
  SyncDiffStats,
} from './sheetsNormalization.js';

const { Pool } = pg;

export class DatabaseConfigurationError extends Error {
  public readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseConfigurationError';
  }
}

export interface StoredAppUser {
  userId: string; // Verified Google Account sub ID
  email: string;
  name: string | null;
  picture: string | null;
  onboardingCompleted: boolean;
  driveRootFolderId: string | null;
  driveSubfolders: Record<string, string>;
  driveLastSyncAt: string | null;
  driveSyncStatus: string | null;
  driveLastError: string | null;
  createdAt: string;
  lastLoginAt: string;
}

export interface StoredOAuthConnection {
  userId: string;
  sessionId?: string;
  googleSub: string;
  email: string;
  name: string | null;
  picture: string | null;
  scopes: string;
  encryptedRefreshToken: string | null;
  encryptedAccessToken: string | null;
  accessTokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSession {
  sessionId: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface StoredWorkspaceState {
  userId: string;
  companySettings: any | null;
  template: any | null;
  fields: any[] | null;
  calculationSettings: any | null;
  preferences: Record<string, any>;
  updatedAt: string;
  version: number;
}

export interface StoredCustomerRecord {
  id: string;
  userId: string;
  data: any;
  updatedAt: string;
}

export interface StoredQuotationRecord {
  id: string;
  userId: string;
  quotationNumber: string;
  status: string;
  customerName: string;
  totalAmount: number;
  validUntil: string;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber: string | null;
  convertedAt: string | null;
  driveFileId: string | null;
  pdfDriveFileId: string | null;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface StoredInvoiceRecord {
  id: string;
  userId: string;
  invoiceNumber: string;
  sourceType: string;
  sourceQuotationId: string | null;
  sourceQuotationNumber: string | null;
  customerName: string;
  totalAmount: number;
  paymentStatus: string;
  driveFileId: string | null;
  pdfDriveFileId: string | null;
  data: any;
  createdAt: string;
  updatedAt: string;
}

export interface StoredSmtpConfig {
  userId: string;
  host: string;
  port: number;
  securityMode: 'SSL' | 'STARTTLS' | 'NONE';
  username: string;
  encryptedPassword: string | null;
  senderName: string;
  senderEmail: string;
  verifiedAt: string | null;
  updatedAt: string;
}

export interface StoredEmailLog {
  id: string;
  userId: string;
  documentType: 'invoice' | 'quotation';
  documentId: string;
  documentNumber: string;
  recipientEmail: string;
  cc: string;
  bcc: string;
  deliveryMethod: 'gmail' | 'smtp';
  senderEmail: string;
  subject: string;
  status: 'sent' | 'failed';
  providerMessageId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface StoredDriveFileRef {
  id: string;
  userId: string;
  entityType: string;
  entityId: string;
  folderKey: string;
  fileName: string;
  driveFileId: string;
  mimeType: string;
  updatedAt: string;
}

export interface PersistedSpreadsheetRecord {
  id: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetUrl: string;
  title: string;
  selectedSheetName: string;
  selectedRange: string;
  headerRowIndex: number;
  sheetsMeta: SheetMetadataItem[];
  worksheets: NormalizedWorksheet[];
  totalRows: number;
  lastSyncAt: string;
  lastSyncStatus: 'synced' | 'no_changes';
  lastSyncStats: SyncDiffStats;
}

export interface SyncHistoryEntry {
  id: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName: string;
  status: 'synced' | 'no_changes' | 'failed';
  rowsRetrieved: number;
  createdCount: number;
  updatedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorMessage: string | null;
  createdAt: string;
}

export interface PersistenceStore {
  // Users & Sessions
  upsertAppUser(params: {
    userId: string;
    email: string;
    name: string | null;
    picture: string | null;
  }): Promise<StoredAppUser>;
  getAppUser(userId: string): Promise<StoredAppUser | null>;
  updateAppUserOnboarding(userId: string, completed: boolean): Promise<void>;
  updateAppUserDriveState(
    userId: string,
    patch: {
      driveRootFolderId?: string | null;
      driveSubfolders?: Record<string, string>;
      driveLastSyncAt?: string | null;
      driveSyncStatus?: string | null;
      driveLastError?: string | null;
    }
  ): Promise<void>;

  createSession(sessionId: string, userId: string, expiresAtIso: string): Promise<StoredSession>;
  getSession(sessionId: string): Promise<StoredSession | null>;
  deleteSession(sessionId: string): Promise<void>;
  deleteAllUserSessions(userId: string): Promise<void>;

  // OAuth Tokens (strictly keyed by verified userId)
  getOAuthConnection(userId: string): Promise<StoredOAuthConnection | null>;
  upsertOAuthConnection(conn: {
    userId: string;
    googleSub: string;
    email: string;
    name: string | null;
    picture: string | null;
    scopes: string;
    encryptedRefreshToken: string | null;
    encryptedAccessToken: string | null;
    accessTokenExpiresAt: string | null;
  }): Promise<StoredOAuthConnection>;
  updateOAuthScopes(userId: string, scopes: string): Promise<void>;
  deleteOAuthConnection(userId: string): Promise<void>;

  // Workspace Settings & Customers
  getWorkspaceState(userId: string): Promise<StoredWorkspaceState | null>;
  upsertWorkspaceState(
    userId: string,
    patch: {
      companySettings?: any;
      template?: any;
      fields?: any[];
      calculationSettings?: any;
      preferences?: Record<string, any>;
    }
  ): Promise<StoredWorkspaceState>;

  listCustomers(userId: string): Promise<StoredCustomerRecord[]>;
  upsertCustomer(userId: string, id: string, data: any): Promise<StoredCustomerRecord>;
  deleteCustomer(userId: string, id: string): Promise<boolean>;

  // Quotations (strict user_id isolation)
  listQuotations(userId: string): Promise<StoredQuotationRecord[]>;
  getQuotation(userId: string, id: string): Promise<StoredQuotationRecord | null>;
  upsertQuotation(userId: string, rec: {
    id: string;
    quotationNumber: string;
    status: string;
    customerName: string;
    totalAmount: number;
    validUntil: string;
    convertedInvoiceId?: string | null;
    convertedInvoiceNumber?: string | null;
    convertedAt?: string | null;
    driveFileId?: string | null;
    pdfDriveFileId?: string | null;
    data: any;
  }): Promise<StoredQuotationRecord>;
  deleteQuotation(userId: string, id: string): Promise<boolean>;

  // Invoices (strict user_id isolation)
  listInvoices(userId: string): Promise<StoredInvoiceRecord[]>;
  getInvoice(userId: string, id: string): Promise<StoredInvoiceRecord | null>;
  upsertInvoice(userId: string, rec: {
    id: string;
    invoiceNumber: string;
    sourceType: string;
    sourceQuotationId?: string | null;
    sourceQuotationNumber?: string | null;
    customerName: string;
    totalAmount: number;
    paymentStatus: string;
    driveFileId?: string | null;
    pdfDriveFileId?: string | null;
    data: any;
  }): Promise<StoredInvoiceRecord>;
  deleteInvoice(userId: string, id: string): Promise<boolean>;

  // Drive File Registry
  listDriveFiles(userId: string): Promise<StoredDriveFileRef[]>;
  getDriveFileRef(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<StoredDriveFileRef | null>;
  upsertDriveFileRef(ref: {
    id: string;
    userId: string;
    entityType: string;
    entityId: string;
    folderKey: string;
    fileName: string;
    driveFileId: string;
    mimeType: string;
  }): Promise<StoredDriveFileRef>;

  // SMTP & Email Logs (strict user_id isolation)
  getSmtpConfig(userId: string): Promise<StoredSmtpConfig | null>;
  upsertSmtpConfig(cfg: {
    userId: string;
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    encryptedPassword?: string | null;
    senderName: string;
    senderEmail: string;
    verifiedAt?: string | null;
  }): Promise<StoredSmtpConfig>;
  insertEmailLog(entry: Omit<StoredEmailLog, 'createdAt'>): Promise<StoredEmailLog>;
  listEmailLogs(userId: string, limit?: number): Promise<StoredEmailLog[]>;

  // Google Sheets Sync (strict user_id isolation)
  getRowHashesForSpreadsheet(userId: string, spreadsheetId: string): Promise<Map<string, string>>;
  saveSyncedSpreadsheetTransaction(params: {
    userId: string;
    spreadsheetId: string;
    spreadsheetUrl: string;
    title: string;
    selectedSheetName: string;
    selectedRange: string;
    headerRowIndex: number;
    sheetsMeta: SheetMetadataItem[];
    worksheets: NormalizedWorksheet[];
    syncedRowRecords: Array<{ sheetName: string; records: NormalizedRowRecord[] }>;
    stats: SyncDiffStats;
    syncStatus: 'synced' | 'no_changes';
    logId: string;
  }): Promise<PersistedSpreadsheetRecord>;
  recordSyncFailureLog(params: {
    logId: string;
    userId: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName: string;
    errorMessage: string;
  }): Promise<void>;
  getLatestSyncedData(
    userId: string,
    spreadsheetId?: string
  ): Promise<{
    spreadsheet: PersistedSpreadsheetRecord | null;
    history: SyncHistoryEntry[];
  }>;
}

let sharedPool: pg.Pool | null = null;
let sharedPoolUrl = '';
let schemaInitializedPromise: Promise<void> | null = null;

function buildPgPool(databaseUrl: string): pg.Pool {
  if (sharedPool && sharedPoolUrl === databaseUrl) {
    return sharedPool;
  }

  const isLocal =
    databaseUrl.includes('localhost') ||
    databaseUrl.includes('127.0.0.1') ||
    databaseUrl.includes('sslmode=disable');

  sharedPool = new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 20000,
    connectionTimeoutMillis: 10000,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  sharedPoolUrl = databaseUrl;
  schemaInitializedPromise = null;
  return sharedPool;
}

async function ensureSchema(pool: pg.Pool): Promise<void> {
  if (!schemaInitializedPromise) {
    schemaInitializedPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS app_users (
          user_id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          name TEXT,
          picture TEXT,
          onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
          drive_root_folder_id TEXT,
          drive_subfolders_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          drive_last_sync_at TIMESTAMPTZ,
          drive_sync_status TEXT,
          drive_last_error TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS app_sessions (
          session_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions (user_id);

        CREATE TABLE IF NOT EXISTS google_oauth_tokens (
          user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
          google_sub TEXT NOT NULL,
          email TEXT NOT NULL,
          name TEXT,
          picture TEXT,
          scopes TEXT NOT NULL,
          encrypted_refresh_token TEXT,
          encrypted_access_token TEXT,
          access_token_expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_workspace_state (
          user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
          company_settings_json JSONB,
          template_json JSONB,
          fields_json JSONB,
          calculation_settings_json JSONB,
          preferences_json JSONB NOT NULL DEFAULT '{}'::jsonb,
          version INTEGER NOT NULL DEFAULT 1,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_customers (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          data_json JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_user_customers_user ON user_customers (user_id);

        CREATE TABLE IF NOT EXISTS user_quotations (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          quotation_number TEXT NOT NULL,
          status TEXT NOT NULL,
          customer_name TEXT NOT NULL DEFAULT '',
          total_amount NUMERIC NOT NULL DEFAULT 0,
          valid_until TEXT NOT NULL DEFAULT '',
          converted_invoice_id TEXT,
          converted_invoice_number TEXT,
          converted_at TIMESTAMPTZ,
          drive_file_id TEXT,
          pdf_drive_file_id TEXT,
          data_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_user_quotations_user ON user_quotations (user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS user_invoices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          invoice_number TEXT NOT NULL,
          source_type TEXT NOT NULL DEFAULT 'manual',
          source_quotation_id TEXT,
          source_quotation_number TEXT,
          customer_name TEXT NOT NULL DEFAULT '',
          total_amount NUMERIC NOT NULL DEFAULT 0,
          payment_status TEXT NOT NULL DEFAULT 'Unpaid',
          drive_file_id TEXT,
          pdf_drive_file_id TEXT,
          data_json JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_user_invoices_user ON user_invoices (user_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS user_drive_files (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          folder_key TEXT NOT NULL,
          file_name TEXT NOT NULL,
          drive_file_id TEXT NOT NULL,
          mime_type TEXT NOT NULL DEFAULT 'application/json',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (user_id, entity_type, entity_id)
        );

        CREATE TABLE IF NOT EXISTS user_smtp_configs (
          user_id TEXT PRIMARY KEY REFERENCES app_users(user_id) ON DELETE CASCADE,
          host TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 587,
          security_mode TEXT NOT NULL DEFAULT 'STARTTLS',
          username TEXT NOT NULL DEFAULT '',
          encrypted_password TEXT,
          sender_name TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          verified_at TIMESTAMPTZ,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS user_email_logs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(user_id) ON DELETE CASCADE,
          document_type TEXT NOT NULL,
          document_id TEXT NOT NULL,
          document_number TEXT NOT NULL,
          recipient_email TEXT NOT NULL,
          cc TEXT NOT NULL DEFAULT '',
          bcc TEXT NOT NULL DEFAULT '',
          delivery_method TEXT NOT NULL,
          sender_email TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          provider_message_id TEXT,
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_user_email_logs_user ON user_email_logs (user_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS synced_spreadsheets (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          spreadsheet_id TEXT NOT NULL,
          spreadsheet_url TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          selected_sheet_name TEXT NOT NULL DEFAULT '',
          selected_range TEXT NOT NULL DEFAULT '',
          header_row_index INTEGER NOT NULL DEFAULT 0,
          sheets_meta_json JSONB NOT NULL,
          worksheets_json JSONB NOT NULL,
          total_rows INTEGER NOT NULL DEFAULT 0,
          last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_sync_status TEXT NOT NULL,
          last_sync_stats_json JSONB NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_synced_spreadsheets_session
          ON synced_spreadsheets (session_id, last_sync_at DESC);

        CREATE TABLE IF NOT EXISTS synced_row_records (
          record_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          spreadsheet_id TEXT NOT NULL,
          sheet_name TEXT NOT NULL,
          row_number INTEGER NOT NULL,
          row_hash TEXT NOT NULL,
          row_data_json JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_synced_row_records_lookup
          ON synced_row_records (session_id, spreadsheet_id, sheet_name);

        CREATE TABLE IF NOT EXISTS sync_history_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          spreadsheet_id TEXT NOT NULL,
          spreadsheet_title TEXT NOT NULL DEFAULT '',
          sheet_name TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL,
          rows_retrieved INTEGER NOT NULL DEFAULT 0,
          created_count INTEGER NOT NULL DEFAULT 0,
          updated_count INTEGER NOT NULL DEFAULT 0,
          unchanged_count INTEGER NOT NULL DEFAULT 0,
          skipped_count INTEGER NOT NULL DEFAULT 0,
          error_message TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_sync_history_session
          ON sync_history_logs (session_id, created_at DESC);
      `);
    })().catch((err) => {
      schemaInitializedPromise = null;
      throw err;
    });
  }
  await schemaInitializedPromise;
}

export class PostgresPersistenceStore implements PersistenceStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    if (!databaseUrl || databaseUrl.includes('MY_DATABASE')) {
      throw new DatabaseConfigurationError(
        'DATABASE_URL is not configured. Connect a PostgreSQL database (such as Vercel Postgres, Neon, or Supabase) to enable multi-user accounts, encrypted Google tokens, and persistent storage.'
      );
    }
    this.pool = buildPgPool(databaseUrl);
  }

  private async ready(): Promise<pg.Pool> {
    await ensureSchema(this.pool);
    return this.pool;
  }

  private mapUser(row: any): StoredAppUser {
    return {
      userId: row.user_id,
      email: row.email,
      name: row.name,
      picture: row.picture,
      onboardingCompleted: Boolean(row.onboarding_completed),
      driveRootFolderId: row.drive_root_folder_id || null,
      driveSubfolders: row.drive_subfolders_json || {},
      driveLastSyncAt: row.drive_last_sync_at ? new Date(row.drive_last_sync_at).toISOString() : null,
      driveSyncStatus: row.drive_sync_status || null,
      driveLastError: row.drive_last_error || null,
      createdAt: new Date(row.created_at).toISOString(),
      lastLoginAt: new Date(row.last_login_at).toISOString(),
    };
  }

  async upsertAppUser(params: {
    userId: string;
    email: string;
    name: string | null;
    picture: string | null;
  }): Promise<StoredAppUser> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO app_users (user_id, email, name, picture, last_login_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email = EXCLUDED.email,
         name = COALESCE(EXCLUDED.name, app_users.name),
         picture = COALESCE(EXCLUDED.picture, app_users.picture),
         last_login_at = NOW()
       RETURNING *`,
      [params.userId, params.email, params.name, params.picture]
    );
    return this.mapUser(res.rows[0]);
  }

  async getAppUser(userId: string): Promise<StoredAppUser | null> {
    const pool = await this.ready();
    const res = await pool.query(`SELECT * FROM app_users WHERE user_id = $1`, [userId]);
    return res.rows[0] ? this.mapUser(res.rows[0]) : null;
  }

  async updateAppUserOnboarding(userId: string, completed: boolean): Promise<void> {
    const pool = await this.ready();
    await pool.query(
      `UPDATE app_users SET onboarding_completed = $2 WHERE user_id = $1`,
      [userId, completed]
    );
  }

  async updateAppUserDriveState(
    userId: string,
    patch: {
      driveRootFolderId?: string | null;
      driveSubfolders?: Record<string, string>;
      driveLastSyncAt?: string | null;
      driveSyncStatus?: string | null;
      driveLastError?: string | null;
    }
  ): Promise<void> {
    const pool = await this.ready();
    const existing = await this.getAppUser(userId);
    if (!existing) return;

    await pool.query(
      `UPDATE app_users SET
        drive_root_folder_id = $2,
        drive_subfolders_json = $3::jsonb,
        drive_last_sync_at = $4,
        drive_sync_status = $5,
        drive_last_error = $6
       WHERE user_id = $1`,
      [
        userId,
        patch.driveRootFolderId !== undefined ? patch.driveRootFolderId : existing.driveRootFolderId,
        JSON.stringify(
          patch.driveSubfolders !== undefined ? patch.driveSubfolders : existing.driveSubfolders
        ),
        patch.driveLastSyncAt !== undefined ? patch.driveLastSyncAt : existing.driveLastSyncAt,
        patch.driveSyncStatus !== undefined ? patch.driveSyncStatus : existing.driveSyncStatus,
        patch.driveLastError !== undefined ? patch.driveLastError : existing.driveLastError,
      ]
    );
  }

  async createSession(sessionId: string, userId: string, expiresAtIso: string): Promise<StoredSession> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO app_sessions (session_id, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [sessionId, userId, expiresAtIso]
    );
    const row = res.rows[0];
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM app_sessions WHERE session_id = $1 AND expires_at > NOW()`,
      [sessionId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      sessionId: row.session_id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    const pool = await this.ready();
    await pool.query(`DELETE FROM app_sessions WHERE session_id = $1`, [sessionId]);
  }

  async deleteAllUserSessions(userId: string): Promise<void> {
    const pool = await this.ready();
    await pool.query(`DELETE FROM app_sessions WHERE user_id = $1`, [userId]);
  }

  async getOAuthConnection(userId: string): Promise<StoredOAuthConnection | null> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM google_oauth_tokens WHERE user_id = $1`,
      [userId]
    );
    const row = res.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      googleSub: row.google_sub,
      email: row.email,
      name: row.name,
      picture: row.picture,
      scopes: row.scopes,
      encryptedRefreshToken: row.encrypted_refresh_token,
      encryptedAccessToken: row.encrypted_access_token,
      accessTokenExpiresAt: row.access_token_expires_at
        ? new Date(row.access_token_expires_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async upsertOAuthConnection(conn: {
    userId: string;
    googleSub: string;
    email: string;
    name: string | null;
    picture: string | null;
    scopes: string;
    encryptedRefreshToken: string | null;
    encryptedAccessToken: string | null;
    accessTokenExpiresAt: string | null;
  }): Promise<StoredOAuthConnection> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO google_oauth_tokens (
        user_id, google_sub, email, name, picture, scopes,
        encrypted_refresh_token, encrypted_access_token, access_token_expires_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        google_sub = EXCLUDED.google_sub,
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        picture = EXCLUDED.picture,
        scopes = EXCLUDED.scopes,
        encrypted_refresh_token = COALESCE(EXCLUDED.encrypted_refresh_token, google_oauth_tokens.encrypted_refresh_token),
        encrypted_access_token = EXCLUDED.encrypted_access_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        updated_at = NOW()
      RETURNING *`,
      [
        conn.userId,
        conn.googleSub,
        conn.email,
        conn.name,
        conn.picture,
        conn.scopes,
        conn.encryptedRefreshToken,
        conn.encryptedAccessToken,
        conn.accessTokenExpiresAt,
      ]
    );
    const row = res.rows[0];
    return {
      userId: row.user_id,
      googleSub: row.google_sub,
      email: row.email,
      name: row.name,
      picture: row.picture,
      scopes: row.scopes,
      encryptedRefreshToken: row.encrypted_refresh_token,
      encryptedAccessToken: row.encrypted_access_token,
      accessTokenExpiresAt: row.access_token_expires_at
        ? new Date(row.access_token_expires_at).toISOString()
        : null,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async updateOAuthScopes(userId: string, scopes: string): Promise<void> {
    const pool = await this.ready();
    await pool.query(
      `UPDATE google_oauth_tokens SET scopes = $2, updated_at = NOW() WHERE user_id = $1`,
      [userId, scopes]
    );
  }

  async deleteOAuthConnection(userId: string): Promise<void> {
    const pool = await this.ready();
    await pool.query(`DELETE FROM google_oauth_tokens WHERE user_id = $1`, [userId]);
  }

  async getWorkspaceState(userId: string): Promise<StoredWorkspaceState | null> {
    const pool = await this.ready();
    const res = await pool.query(`SELECT * FROM user_workspace_state WHERE user_id = $1`, [userId]);
    const row = res.rows[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      companySettings: row.company_settings_json,
      template: row.template_json,
      fields: row.fields_json,
      calculationSettings: row.calculation_settings_json,
      preferences: row.preferences_json || {},
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async upsertWorkspaceState(
    userId: string,
    patch: {
      companySettings?: any;
      template?: any;
      fields?: any[];
      calculationSettings?: any;
      preferences?: Record<string, any>;
    }
  ): Promise<StoredWorkspaceState> {
    const pool = await this.ready();
    const existing = await this.getWorkspaceState(userId);
    const res = await pool.query(
      `INSERT INTO user_workspace_state (
        user_id, company_settings_json, template_json, fields_json, calculation_settings_json, preferences_json, version, updated_at
      ) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        company_settings_json = EXCLUDED.company_settings_json,
        template_json = EXCLUDED.template_json,
        fields_json = EXCLUDED.fields_json,
        calculation_settings_json = EXCLUDED.calculation_settings_json,
        preferences_json = EXCLUDED.preferences_json,
        version = user_workspace_state.version + 1,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        JSON.stringify(
          patch.companySettings !== undefined ? patch.companySettings : existing?.companySettings ?? null
        ),
        JSON.stringify(patch.template !== undefined ? patch.template : existing?.template ?? null),
        JSON.stringify(patch.fields !== undefined ? patch.fields : existing?.fields ?? null),
        JSON.stringify(
          patch.calculationSettings !== undefined
            ? patch.calculationSettings
            : existing?.calculationSettings ?? null
        ),
        JSON.stringify(
          patch.preferences !== undefined ? patch.preferences : existing?.preferences ?? {}
        ),
      ]
    );
    const row = res.rows[0];
    return {
      userId: row.user_id,
      companySettings: row.company_settings_json,
      template: row.template_json,
      fields: row.fields_json,
      calculationSettings: row.calculation_settings_json,
      preferences: row.preferences_json || {},
      version: row.version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async listCustomers(userId: string): Promise<StoredCustomerRecord[]> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_customers WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      data: r.data_json,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async upsertCustomer(userId: string, id: string, data: any): Promise<StoredCustomerRecord> {
    const pool = await this.ready();
    const existing = await pool.query(`SELECT user_id FROM user_customers WHERE id = $1`, [id]);
    if (existing.rows[0] && existing.rows[0].user_id !== userId) {
      throw new Error('Forbidden: customer record belongs to another user.');
    }
    const res = await pool.query(
      `INSERT INTO user_customers (id, user_id, data_json, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (id) DO UPDATE SET
         data_json = EXCLUDED.data_json,
         updated_at = NOW()
       WHERE user_customers.user_id = $2
       RETURNING *`,
      [id, userId, JSON.stringify(data)]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      data: r.data_json,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async deleteCustomer(userId: string, id: string): Promise<boolean> {
    const pool = await this.ready();
    const res = await pool.query(
      `DELETE FROM user_customers WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (res.rowCount || 0) > 0;
  }

  private mapQuotation(r: any): StoredQuotationRecord {
    return {
      id: r.id,
      userId: r.user_id,
      quotationNumber: r.quotation_number,
      status: r.status,
      customerName: r.customer_name,
      totalAmount: Number(r.total_amount || 0),
      validUntil: r.valid_until || '',
      convertedInvoiceId: r.converted_invoice_id || null,
      convertedInvoiceNumber: r.converted_invoice_number || null,
      convertedAt: r.converted_at ? new Date(r.converted_at).toISOString() : null,
      driveFileId: r.drive_file_id || null,
      pdfDriveFileId: r.pdf_drive_file_id || null,
      data: r.data_json,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async listQuotations(userId: string): Promise<StoredQuotationRecord[]> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_quotations WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((r) => this.mapQuotation(r));
  }

  async getQuotation(userId: string, id: string): Promise<StoredQuotationRecord | null> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_quotations WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ? this.mapQuotation(res.rows[0]) : null;
  }

  async upsertQuotation(
    userId: string,
    rec: {
      id: string;
      quotationNumber: string;
      status: string;
      customerName: string;
      totalAmount: number;
      validUntil: string;
      convertedInvoiceId?: string | null;
      convertedInvoiceNumber?: string | null;
      convertedAt?: string | null;
      driveFileId?: string | null;
      pdfDriveFileId?: string | null;
      data: any;
    }
  ): Promise<StoredQuotationRecord> {
    const pool = await this.ready();
    const existingOwner = await pool.query(`SELECT user_id FROM user_quotations WHERE id = $1`, [
      rec.id,
    ]);
    if (existingOwner.rows[0] && existingOwner.rows[0].user_id !== userId) {
      throw new Error('Forbidden: quotation record belongs to another user.');
    }
    const res = await pool.query(
      `INSERT INTO user_quotations (
        id, user_id, quotation_number, status, customer_name, total_amount, valid_until,
        converted_invoice_id, converted_invoice_number, converted_at, drive_file_id, pdf_drive_file_id, data_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        quotation_number = EXCLUDED.quotation_number,
        status = EXCLUDED.status,
        customer_name = EXCLUDED.customer_name,
        total_amount = EXCLUDED.total_amount,
        valid_until = EXCLUDED.valid_until,
        converted_invoice_id = COALESCE(EXCLUDED.converted_invoice_id, user_quotations.converted_invoice_id),
        converted_invoice_number = COALESCE(EXCLUDED.converted_invoice_number, user_quotations.converted_invoice_number),
        converted_at = COALESCE(EXCLUDED.converted_at, user_quotations.converted_at),
        drive_file_id = COALESCE(EXCLUDED.drive_file_id, user_quotations.drive_file_id),
        pdf_drive_file_id = COALESCE(EXCLUDED.pdf_drive_file_id, user_quotations.pdf_drive_file_id),
        data_json = EXCLUDED.data_json,
        updated_at = NOW()
      WHERE user_quotations.user_id = $2
      RETURNING *`,
      [
        rec.id,
        userId,
        rec.quotationNumber,
        rec.status,
        rec.customerName,
        rec.totalAmount,
        rec.validUntil,
        rec.convertedInvoiceId ?? null,
        rec.convertedInvoiceNumber ?? null,
        rec.convertedAt ?? null,
        rec.driveFileId ?? null,
        rec.pdfDriveFileId ?? null,
        JSON.stringify(rec.data),
      ]
    );
    return this.mapQuotation(res.rows[0]);
  }

  async deleteQuotation(userId: string, id: string): Promise<boolean> {
    const pool = await this.ready();
    const res = await pool.query(
      `DELETE FROM user_quotations WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (res.rowCount || 0) > 0;
  }

  private mapInvoice(r: any): StoredInvoiceRecord {
    return {
      id: r.id,
      userId: r.user_id,
      invoiceNumber: r.invoice_number,
      sourceType: r.source_type,
      sourceQuotationId: r.source_quotation_id || null,
      sourceQuotationNumber: r.source_quotation_number || null,
      customerName: r.customer_name,
      totalAmount: Number(r.total_amount || 0),
      paymentStatus: r.payment_status || 'Unpaid',
      driveFileId: r.drive_file_id || null,
      pdfDriveFileId: r.pdf_drive_file_id || null,
      data: r.data_json,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async listInvoices(userId: string): Promise<StoredInvoiceRecord[]> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_invoices WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((r) => this.mapInvoice(r));
  }

  async getInvoice(userId: string, id: string): Promise<StoredInvoiceRecord | null> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_invoices WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return res.rows[0] ? this.mapInvoice(res.rows[0]) : null;
  }

  async upsertInvoice(
    userId: string,
    rec: {
      id: string;
      invoiceNumber: string;
      sourceType: string;
      sourceQuotationId?: string | null;
      sourceQuotationNumber?: string | null;
      customerName: string;
      totalAmount: number;
      paymentStatus: string;
      driveFileId?: string | null;
      pdfDriveFileId?: string | null;
      data: any;
    }
  ): Promise<StoredInvoiceRecord> {
    const pool = await this.ready();
    const existingOwner = await pool.query(`SELECT user_id FROM user_invoices WHERE id = $1`, [
      rec.id,
    ]);
    if (existingOwner.rows[0] && existingOwner.rows[0].user_id !== userId) {
      throw new Error('Forbidden: invoice record belongs to another user.');
    }
    const res = await pool.query(
      `INSERT INTO user_invoices (
        id, user_id, invoice_number, source_type, source_quotation_id, source_quotation_number,
        customer_name, total_amount, payment_status, drive_file_id, pdf_drive_file_id, data_json, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        invoice_number = EXCLUDED.invoice_number,
        source_type = EXCLUDED.source_type,
        source_quotation_id = COALESCE(EXCLUDED.source_quotation_id, user_invoices.source_quotation_id),
        source_quotation_number = COALESCE(EXCLUDED.source_quotation_number, user_invoices.source_quotation_number),
        customer_name = EXCLUDED.customer_name,
        total_amount = EXCLUDED.total_amount,
        payment_status = EXCLUDED.payment_status,
        drive_file_id = COALESCE(EXCLUDED.drive_file_id, user_invoices.drive_file_id),
        pdf_drive_file_id = COALESCE(EXCLUDED.pdf_drive_file_id, user_invoices.pdf_drive_file_id),
        data_json = EXCLUDED.data_json,
        updated_at = NOW()
      WHERE user_invoices.user_id = $2
      RETURNING *`,
      [
        rec.id,
        userId,
        rec.invoiceNumber,
        rec.sourceType,
        rec.sourceQuotationId ?? null,
        rec.sourceQuotationNumber ?? null,
        rec.customerName,
        rec.totalAmount,
        rec.paymentStatus,
        rec.driveFileId ?? null,
        rec.pdfDriveFileId ?? null,
        JSON.stringify(rec.data),
      ]
    );
    return this.mapInvoice(res.rows[0]);
  }

  async deleteInvoice(userId: string, id: string): Promise<boolean> {
    const pool = await this.ready();
    const res = await pool.query(
      `DELETE FROM user_invoices WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );
    return (res.rowCount || 0) > 0;
  }

  async listDriveFiles(userId: string): Promise<StoredDriveFileRef[]> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_drive_files WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      folderKey: r.folder_key,
      fileName: r.file_name,
      driveFileId: r.drive_file_id,
      mimeType: r.mime_type,
      updatedAt: new Date(r.updated_at).toISOString(),
    }));
  }

  async getDriveFileRef(
    userId: string,
    entityType: string,
    entityId: string
  ): Promise<StoredDriveFileRef | null> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_drive_files WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [userId, entityType, entityId]
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      userId: r.user_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      folderKey: r.folder_key,
      fileName: r.file_name,
      driveFileId: r.drive_file_id,
      mimeType: r.mime_type,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async upsertDriveFileRef(ref: {
    id: string;
    userId: string;
    entityType: string;
    entityId: string;
    folderKey: string;
    fileName: string;
    driveFileId: string;
    mimeType: string;
  }): Promise<StoredDriveFileRef> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO user_drive_files (
        id, user_id, entity_type, entity_id, folder_key, file_name, drive_file_id, mime_type, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (user_id, entity_type, entity_id) DO UPDATE SET
        folder_key = EXCLUDED.folder_key,
        file_name = EXCLUDED.file_name,
        drive_file_id = EXCLUDED.drive_file_id,
        mime_type = EXCLUDED.mime_type,
        updated_at = NOW()
      RETURNING *`,
      [
        ref.id,
        ref.userId,
        ref.entityType,
        ref.entityId,
        ref.folderKey,
        ref.fileName,
        ref.driveFileId,
        ref.mimeType,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      folderKey: r.folder_key,
      fileName: r.file_name,
      driveFileId: r.drive_file_id,
      mimeType: r.mime_type,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async getSmtpConfig(userId: string): Promise<StoredSmtpConfig | null> {
    const pool = await this.ready();
    const res = await pool.query(`SELECT * FROM user_smtp_configs WHERE user_id = $1`, [userId]);
    const r = res.rows[0];
    if (!r) return null;
    return {
      userId: r.user_id,
      host: r.host,
      port: Number(r.port),
      securityMode: r.security_mode as 'SSL' | 'STARTTLS' | 'NONE',
      username: r.username,
      encryptedPassword: r.encrypted_password,
      senderName: r.sender_name,
      senderEmail: r.sender_email,
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async upsertSmtpConfig(cfg: {
    userId: string;
    host: string;
    port: number;
    securityMode: 'SSL' | 'STARTTLS' | 'NONE';
    username: string;
    encryptedPassword?: string | null;
    senderName: string;
    senderEmail: string;
    verifiedAt?: string | null;
  }): Promise<StoredSmtpConfig> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO user_smtp_configs (
        user_id, host, port, security_mode, username, encrypted_password, sender_name, sender_email, verified_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        host = EXCLUDED.host,
        port = EXCLUDED.port,
        security_mode = EXCLUDED.security_mode,
        username = EXCLUDED.username,
        encrypted_password = COALESCE(EXCLUDED.encrypted_password, user_smtp_configs.encrypted_password),
        sender_name = EXCLUDED.sender_name,
        sender_email = EXCLUDED.sender_email,
        verified_at = COALESCE(EXCLUDED.verified_at, user_smtp_configs.verified_at),
        updated_at = NOW()
      RETURNING *`,
      [
        cfg.userId,
        cfg.host,
        cfg.port,
        cfg.securityMode,
        cfg.username,
        cfg.encryptedPassword ?? null,
        cfg.senderName,
        cfg.senderEmail,
        cfg.verifiedAt ?? null,
      ]
    );
    const r = res.rows[0];
    return {
      userId: r.user_id,
      host: r.host,
      port: Number(r.port),
      securityMode: r.security_mode as 'SSL' | 'STARTTLS' | 'NONE',
      username: r.username,
      encryptedPassword: r.encrypted_password,
      senderName: r.sender_name,
      senderEmail: r.sender_email,
      verifiedAt: r.verified_at ? new Date(r.verified_at).toISOString() : null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  async insertEmailLog(entry: Omit<StoredEmailLog, 'createdAt'>): Promise<StoredEmailLog> {
    const pool = await this.ready();
    const res = await pool.query(
      `INSERT INTO user_email_logs (
        id, user_id, document_type, document_id, document_number, recipient_email, cc, bcc,
        delivery_method, sender_email, subject, status, provider_message_id, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
      RETURNING *`,
      [
        entry.id,
        entry.userId,
        entry.documentType,
        entry.documentId,
        entry.documentNumber,
        entry.recipientEmail,
        entry.cc,
        entry.bcc,
        entry.deliveryMethod,
        entry.senderEmail,
        entry.subject,
        entry.status,
        entry.providerMessageId,
        entry.errorMessage,
      ]
    );
    const r = res.rows[0];
    return {
      id: r.id,
      userId: r.user_id,
      documentType: r.document_type,
      documentId: r.document_id,
      documentNumber: r.document_number,
      recipientEmail: r.recipient_email,
      cc: r.cc,
      bcc: r.bcc,
      deliveryMethod: r.delivery_method,
      senderEmail: r.sender_email,
      subject: r.subject,
      status: r.status,
      providerMessageId: r.provider_message_id,
      errorMessage: r.error_message,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }

  async listEmailLogs(userId: string, limit: number = 100): Promise<StoredEmailLog[]> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT * FROM user_email_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return res.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      documentType: r.document_type,
      documentId: r.document_id,
      documentNumber: r.document_number,
      recipientEmail: r.recipient_email,
      cc: r.cc,
      bcc: r.bcc,
      deliveryMethod: r.delivery_method,
      senderEmail: r.sender_email,
      subject: r.subject,
      status: r.status,
      providerMessageId: r.provider_message_id,
      errorMessage: r.error_message,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  // Sheets tables scoped strictly by userId (stored in session_id column for seamless schema compatibility)
  async getRowHashesForSpreadsheet(
    userId: string,
    spreadsheetId: string
  ): Promise<Map<string, string>> {
    const pool = await this.ready();
    const res = await pool.query(
      `SELECT record_key, row_hash FROM synced_row_records
       WHERE session_id = $1 AND spreadsheet_id = $2`,
      [userId, spreadsheetId]
    );
    const map = new Map<string, string>();
    for (const r of res.rows) {
      map.set(r.record_key, r.row_hash);
    }
    return map;
  }

  async saveSyncedSpreadsheetTransaction(params: {
    userId: string;
    spreadsheetId: string;
    spreadsheetUrl: string;
    title: string;
    selectedSheetName: string;
    selectedRange: string;
    headerRowIndex: number;
    sheetsMeta: SheetMetadataItem[];
    worksheets: NormalizedWorksheet[];
    syncedRowRecords: Array<{ sheetName: string; records: NormalizedRowRecord[] }>;
    stats: SyncDiffStats;
    syncStatus: 'synced' | 'no_changes';
    logId: string;
  }): Promise<PersistedSpreadsheetRecord> {
    const pool = await this.ready();
    const client = await pool.connect();
    const recordId = `${params.userId}::${params.spreadsheetId}`;
    const totalRows = params.worksheets.reduce((sum, ws) => sum + ws.rows.length, 0);

    try {
      await client.query('BEGIN');

      const sheetRes = await client.query(
        `INSERT INTO synced_spreadsheets (
          id, session_id, spreadsheet_id, spreadsheet_url, title,
          selected_sheet_name, selected_range, header_row_index,
          sheets_meta_json, worksheets_json, total_rows,
          last_sync_at, last_sync_status, last_sync_stats_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, NOW(), $12, $13::jsonb)
        ON CONFLICT (id) DO UPDATE SET
          spreadsheet_url = EXCLUDED.spreadsheet_url,
          title = EXCLUDED.title,
          selected_sheet_name = EXCLUDED.selected_sheet_name,
          selected_range = EXCLUDED.selected_range,
          header_row_index = EXCLUDED.header_row_index,
          sheets_meta_json = EXCLUDED.sheets_meta_json,
          worksheets_json = EXCLUDED.worksheets_json,
          total_rows = EXCLUDED.total_rows,
          last_sync_at = NOW(),
          last_sync_status = EXCLUDED.last_sync_status,
          last_sync_stats_json = EXCLUDED.last_sync_stats_json
        RETURNING last_sync_at`,
        [
          recordId,
          params.userId,
          params.spreadsheetId,
          params.spreadsheetUrl,
          params.title,
          params.selectedSheetName,
          params.selectedRange,
          params.headerRowIndex,
          JSON.stringify(params.sheetsMeta),
          JSON.stringify(params.worksheets),
          totalRows,
          params.syncStatus,
          JSON.stringify(params.stats),
        ]
      );

      await client.query(
        `DELETE FROM synced_row_records WHERE session_id = $1 AND spreadsheet_id = $2`,
        [params.userId, params.spreadsheetId]
      );

      for (const group of params.syncedRowRecords) {
        if (group.records.length === 0) continue;
        const chunkSize = 200;
        for (let i = 0; i < group.records.length; i += chunkSize) {
          const chunk = group.records.slice(i, i + chunkSize);
          const values: any[] = [];
          const placeholders: string[] = [];
          chunk.forEach((rec, idx) => {
            const base = idx * 7;
            const compositeKey = `${params.userId}::${params.spreadsheetId}::${group.sheetName}::${rec.rowKey}`;
            placeholders.push(
              `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb, NOW())`
            );
            values.push(
              compositeKey,
              params.userId,
              params.spreadsheetId,
              group.sheetName,
              rec.rowNumber,
              rec.rowHash,
              JSON.stringify(rec.data)
            );
          });

          await client.query(
            `INSERT INTO synced_row_records (
              record_key, session_id, spreadsheet_id, sheet_name, row_number, row_hash, row_data_json, updated_at
            ) VALUES ${placeholders.join(', ')}`,
            values
          );
        }
      }

      await client.query(
        `INSERT INTO sync_history_logs (
          id, session_id, spreadsheet_id, spreadsheet_title, sheet_name,
          status, rows_retrieved, created_count, updated_count, unchanged_count, skipped_count, error_message, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULL, NOW())`,
        [
          params.logId,
          params.userId,
          params.spreadsheetId,
          params.title,
          params.selectedSheetName,
          params.syncStatus,
          params.stats.rowsRetrieved,
          params.stats.createdCount,
          params.stats.updatedCount,
          params.stats.unchangedCount,
          params.stats.skippedCount,
        ]
      );

      await client.query('COMMIT');

      return {
        id: recordId,
        userId: params.userId,
        spreadsheetId: params.spreadsheetId,
        spreadsheetUrl: params.spreadsheetUrl,
        title: params.title,
        selectedSheetName: params.selectedSheetName,
        selectedRange: params.selectedRange,
        headerRowIndex: params.headerRowIndex,
        sheetsMeta: params.sheetsMeta,
        worksheets: params.worksheets,
        totalRows,
        lastSyncAt: new Date(sheetRes.rows[0].last_sync_at).toISOString(),
        lastSyncStatus: params.syncStatus,
        lastSyncStats: params.stats,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async recordSyncFailureLog(params: {
    logId: string;
    userId: string;
    spreadsheetId: string;
    spreadsheetTitle: string;
    sheetName: string;
    errorMessage: string;
  }): Promise<void> {
    const pool = await this.ready();
    await pool.query(
      `INSERT INTO sync_history_logs (
        id, session_id, spreadsheet_id, spreadsheet_title, sheet_name,
        status, rows_retrieved, created_count, updated_count, unchanged_count, skipped_count, error_message, created_at
      ) VALUES ($1, $2, $3, $4, $5, 'failed', 0, 0, 0, 0, 0, $6, NOW())`,
      [
        params.logId,
        params.userId,
        params.spreadsheetId,
        params.spreadsheetTitle,
        params.sheetName,
        params.errorMessage,
      ]
    );
  }

  async getLatestSyncedData(
    userId: string,
    spreadsheetId?: string
  ): Promise<{
    spreadsheet: PersistedSpreadsheetRecord | null;
    history: SyncHistoryEntry[];
  }> {
    const pool = await this.ready();
    const sheetRes = spreadsheetId
      ? await pool.query(
          `SELECT * FROM synced_spreadsheets WHERE session_id = $1 AND spreadsheet_id = $2 LIMIT 1`,
          [userId, spreadsheetId]
        )
      : await pool.query(
          `SELECT * FROM synced_spreadsheets WHERE session_id = $1 ORDER BY last_sync_at DESC LIMIT 1`,
          [userId]
        );

    const historyRes = await pool.query(
      `SELECT * FROM sync_history_logs WHERE session_id = $1 ORDER BY created_at DESC LIMIT 15`,
      [userId]
    );

    const row = sheetRes.rows[0];
    const spreadsheet: PersistedSpreadsheetRecord | null = row
      ? {
          id: row.id,
          userId: row.session_id,
          spreadsheetId: row.spreadsheet_id,
          spreadsheetUrl: row.spreadsheet_url,
          title: row.title,
          selectedSheetName: row.selected_sheet_name,
          selectedRange: row.selected_range,
          headerRowIndex: row.header_row_index,
          sheetsMeta: row.sheets_meta_json,
          worksheets: row.worksheets_json,
          totalRows: row.total_rows,
          lastSyncAt: new Date(row.last_sync_at).toISOString(),
          lastSyncStatus: row.last_sync_status,
          lastSyncStats: row.last_sync_stats_json,
        }
      : null;

    const history: SyncHistoryEntry[] = historyRes.rows.map((h) => ({
      id: h.id,
      userId: h.session_id,
      spreadsheetId: h.spreadsheet_id,
      spreadsheetTitle: h.spreadsheet_title,
      sheetName: h.sheet_name,
      status: h.status,
      rowsRetrieved: h.rows_retrieved,
      createdCount: h.created_count,
      updatedCount: h.updated_count,
      unchangedCount: h.unchanged_count,
      skippedCount: h.skipped_count,
      errorMessage: h.error_message,
      createdAt: new Date(h.created_at).toISOString(),
    }));

    return { spreadsheet, history };
  }
}

export function createPersistenceStore(databaseUrl: string): PersistenceStore {
  return new PostgresPersistenceStore(databaseUrl);
}
