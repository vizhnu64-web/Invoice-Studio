/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export class HttpApiError extends Error {
  status: number;
  code: string;
  details?: Record<string, any>;

  constructor(status: number, code: string, message: string, details?: Record<string, any>) {
    super(message);
    this.name = 'HttpApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
