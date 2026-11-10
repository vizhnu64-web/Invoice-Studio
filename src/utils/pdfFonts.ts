/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { NOTO_SANS_REGULAR_B64, NOTO_SANS_BOLD_B64 } from './fonts/notoSansBase64';
import { DEJAVU_SANS_REGULAR_B64, DEJAVU_SANS_BOLD_B64 } from './fonts/dejaVuSansBase64';

/**
 * Registers embedded TrueType Unicode fonts (NotoSans and DejaVuSans) into the jsPDF instance.
 * Embeds full character coverage including the Indian Rupee symbol (₹ U+20B9),
 * currency symbols, and Arabic glyphs for AED/SAR.
 */
export function registerUnicodeFonts(doc: any): { defaultFont: string } {
  try {
    // 1. Register NotoSans (Standard Unicode Sans-Serif with full Rupee ₹ U+20B9 support)
    doc.addFileToVFS('NotoSans-Regular.ttf', NOTO_SANS_REGULAR_B64);
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');

    doc.addFileToVFS('NotoSans-Bold.ttf', NOTO_SANS_BOLD_B64);
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

    // 2. Register DejaVuSans (Fallback Unicode Font with Arabic coverage for AED د.إ / SAR ر.س)
    doc.addFileToVFS('DejaVuSans.ttf', DEJAVU_SANS_REGULAR_B64);
    doc.addFont('DejaVuSans.ttf', 'DejaVuSans', 'normal');

    doc.addFileToVFS('DejaVuSans-Bold.ttf', DEJAVU_SANS_BOLD_B64);
    doc.addFont('DejaVuSans-Bold.ttf', 'DejaVuSans', 'bold');
  } catch (err) {
    console.warn('Font registration error:', err);
  }

  return { defaultFont: 'NotoSans' };
}

/**
 * Resolves the appropriate registered TrueType font for a given currency symbol or body text.
 * If text contains Arabic script (e.g. د.إ or ر.س), returns DejaVuSans.
 * Otherwise returns NotoSans (which cleanly supports ₹ U+20B9, $, €, £, ¥, S$, etc.).
 */
export function resolveUnicodeFont(symbolOrText: string = '', preferredFont?: string): string {
  // If text contains Arabic characters, use DejaVuSans
  if (/[\u0600-\u06FF]/.test(symbolOrText)) {
    return 'DejaVuSans';
  }

  // If company settings requested Times or Courier specifically and symbol doesn't conflict
  if (preferredFont && !symbolOrText.includes('₹')) {
    const lower = preferredFont.toLowerCase();
    if (lower.includes('times')) return 'times';
    if (lower.includes('courier')) return 'courier';
  }

  // Default to NotoSans which is verified TrueType embedded Unicode
  return 'NotoSans';
}
