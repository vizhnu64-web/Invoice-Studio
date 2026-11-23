/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { fetchGoogleClientConfig } from './googleAuthClient';

export interface PickedDriveItem {
  id: string;
  name: string;
  mimeType?: string;
  url: string;
}

let pickerLoadPromise: Promise<void> | null = null;

function getPickerOrigin(): string {
  if (typeof window === 'undefined') return '';
  const ancestors = (window.location as any).ancestorOrigins;
  if (ancestors && ancestors.length > 0) {
    return String(ancestors[ancestors.length - 1]);
  }
  return window.location.origin;
}

export function loadGooglePickerApi(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google Picker requires a browser environment.'));
  }
  if (window.google?.picker?.PickerBuilder) {
    return Promise.resolve();
  }
  if (pickerLoadPromise) return pickerLoadPromise;

  pickerLoadPromise = new Promise<void>((resolve, reject) => {
    const finishGapiLoad = () => {
      if (!window.gapi?.load) {
        pickerLoadPromise = null;
        reject(new Error('Google API loader (gapi) is unavailable.'));
        return;
      }
      window.gapi.load('picker', {
        callback: () => {
          if (window.google?.picker?.PickerBuilder) {
            resolve();
          } else {
            pickerLoadPromise = null;
            reject(new Error('Google Picker library loaded but PickerBuilder was not initialized.'));
          }
        },
        onerror: () => {
          pickerLoadPromise = null;
          reject(new Error('Failed to initialize Google Picker API.'));
        },
      });
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://apis.google.com/js/api.js"]'
    );
    if (existing) {
      if (window.gapi?.load) {
        finishGapiLoad();
        return;
      }
      existing.addEventListener('load', finishGapiLoad, { once: true });
      existing.addEventListener(
        'error',
        () => {
          pickerLoadPromise = null;
          reject(new Error('Failed to load Google API script (apis.google.com/js/api.js).'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/api.js';
    script.async = true;
    script.defer = true;
    script.onload = finishGapiLoad;
    script.onerror = () => {
      pickerLoadPromise = null;
      reject(new Error('Could not load Google Picker API script. Check network/ad-blocker settings.'));
    };
    document.head.appendChild(script);
  });

  return pickerLoadPromise;
}

/**
 * Opens the official Google Picker dialog filtered strictly to Google Drive folders.
 * Selecting a folder grants the app's `drive.file` scope access to that folder.
 */
export async function openDriveFolderPicker(
  accessToken: string
): Promise<PickedDriveItem | null> {
  const cfg = await fetchGoogleClientConfig();
  if (!cfg.apiKey || !cfg.appId) {
    throw new Error(
      'Google Picker requires VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID to be configured in your deployment environment.'
    );
  }

  await loadGooglePickerApi();
  const pickerApi = window.google?.picker;
  if (!pickerApi) {
    throw new Error('Google Picker is not available.');
  }

  return new Promise<PickedDriveItem | null>((resolve, reject) => {
    try {
      const folderView = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes('application/vnd.google-apps.folder');

      const builder = new pickerApi.PickerBuilder()
        .setTitle('Select your Invoice Studio folder in Google Drive')
        .addView(folderView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(cfg.apiKey)
        .setAppId(cfg.appId)
        .setOrigin(getPickerOrigin())
        .setCallback((data: any) => {
          if (data.action === pickerApi.Action.PICKED) {
            const doc = data.docs?.[0];
            if (!doc?.id) {
              resolve(null);
              return;
            }
            resolve({
              id: String(doc.id),
              name: String(doc.name || 'Invoice Studio'),
              mimeType: doc.mimeType ? String(doc.mimeType) : 'application/vnd.google-apps.folder',
              url: doc.url
                ? String(doc.url)
                : `https://drive.google.com/drive/folders/${doc.id}`,
            });
          } else if (data.action === pickerApi.Action.CANCEL) {
            resolve(null);
          }
        });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err: any) {
      reject(new Error(err?.message || 'Unable to open Google Drive Folder Picker.'));
    }
  });
}

/**
 * Opens the official Google Picker dialog filtered to Google Spreadsheets.
 */
export async function openGoogleSpreadsheetPicker(
  accessToken: string
): Promise<PickedDriveItem | null> {
  const cfg = await fetchGoogleClientConfig();
  if (!cfg.apiKey || !cfg.appId) {
    throw new Error(
      'Google Picker requires VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID to be configured in your deployment environment.'
    );
  }

  await loadGooglePickerApi();
  const pickerApi = window.google?.picker;
  if (!pickerApi) {
    throw new Error('Google Picker is not available.');
  }

  return new Promise<PickedDriveItem | null>((resolve, reject) => {
    try {
      const sheetsView = new pickerApi.DocsView(pickerApi.ViewId.SPREADSHEETS)
        .setMimeTypes('application/vnd.google-apps.spreadsheet');

      const builder = new pickerApi.PickerBuilder()
        .setTitle('Select a Google Spreadsheet to Import')
        .addView(sheetsView)
        .setOAuthToken(accessToken)
        .setDeveloperKey(cfg.apiKey)
        .setAppId(cfg.appId)
        .setOrigin(getPickerOrigin())
        .setCallback((data: any) => {
          if (data.action === pickerApi.Action.PICKED) {
            const doc = data.docs?.[0];
            if (!doc?.id) {
              resolve(null);
              return;
            }
            resolve({
              id: String(doc.id),
              name: String(doc.name || 'Google Spreadsheet'),
              mimeType: doc.mimeType || 'application/vnd.google-apps.spreadsheet',
              url: doc.url
                ? String(doc.url)
                : `https://docs.google.com/spreadsheets/d/${doc.id}/edit`,
            });
          } else if (data.action === pickerApi.Action.CANCEL) {
            resolve(null);
          }
        });

      const picker = builder.build();
      picker.setVisible(true);
    } catch (err: any) {
      reject(new Error(err?.message || 'Unable to open Google Spreadsheet Picker.'));
    }
  });
}
