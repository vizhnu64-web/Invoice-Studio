/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumericValue } from './calculator';

/**
 * Safe Arithmetic Formula Parser
 * Evaluates basic arithmetic expressions with field variables without using unsafe `eval()` or `Function()`.
 * Supports: +, -, *, /, %, (), and numeric literals or variable identifiers.
 */

export interface FormulaToken {
  type: 'NUMBER' | 'VARIABLE' | 'OPERATOR' | 'LPAREN' | 'RPAREN';
  value: string | number;
}

export interface FormulaEvaluationResult {
  success: boolean;
  value: number;
  error?: string;
}

/**
 * Validates formula syntax before evaluation.
 * Rejects unmatched parentheses, invalid characters, function calls, or dangerous tokens.
 */
export function validateFormulaSyntax(expr: string): { valid: boolean; error?: string } {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    return { valid: false, error: 'Empty formula expression' };
  }

  const s = expr.trim();

  // Check for disallowed patterns like function invocation e.g. alert(, foo(, eval(
  if (/[a-zA-Z_]\s*\(/.test(s)) {
    return { valid: false, error: 'Function calls are not allowed in formulas' };
  }

  // Check for invalid characters (only allow letters, digits, spaces, []()+ - * / × ÷ %)
  if (/[^a-zA-Z0-9_\s\[\]()+*\/\-×÷%.]/.test(s)) {
    return { valid: false, error: 'Formula contains unsupported characters' };
  }

  // Check parentheses balance
  let parenCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') parenCount++;
    if (s[i] === ')') parenCount--;
    if (parenCount < 0) {
      return { valid: false, error: 'Mismatched parentheses: closing bracket before opening' };
    }
  }
  if (parenCount !== 0) {
    return { valid: false, error: 'Mismatched parentheses: unclosed bracket' };
  }

  // Check bracket balance for [Variable]
  let bracketCount = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '[') bracketCount++;
    if (s[i] === ']') bracketCount--;
    if (bracketCount < 0 || bracketCount > 1) {
      return { valid: false, error: 'Mismatched variable brackets' };
    }
  }
  if (bracketCount !== 0) {
    return { valid: false, error: 'Mismatched variable brackets: unclosed bracket' };
  }

  return { valid: true };
}

export function tokenizeFormula(expr: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let i = 0;
  const s = expr.trim();

  while (i < s.length) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')' });
      i++;
      continue;
    }

    if (['+', '-', '*', '/', '×', '÷', '%'].includes(ch)) {
      const op = ch === '×' ? '*' : ch === '÷' ? '/' : ch;
      tokens.push({ type: 'OPERATOR', value: op });
      i++;
      continue;
    }

    // Numbers (including decimals)
    if (/\d/.test(ch) || (ch === '.' && i + 1 < s.length && /\d/.test(s[i + 1]))) {
      let numStr = '';
      while (i < s.length && (/[\d.]/.test(s[i]))) {
        numStr += s[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: parseFloat(numStr) });
      continue;
    }

    // Identifiers / variable names e.g. [Quantity]
    if (ch === '[') {
      let varName = '';
      i++; // skip '['
      while (i < s.length && s[i] !== ']') {
        varName += s[i];
        i++;
      }
      if (i < s.length && s[i] === ']') i++; // skip ']'
      tokens.push({ type: 'VARIABLE', value: varName.trim() });
      continue;
    }

    if (/[a-zA-Z_]/.test(ch)) {
      let varName = '';
      while (i < s.length && /[a-zA-Z0-9_]/.test(s[i])) {
        varName += s[i];
        i++;
      }
      tokens.push({ type: 'VARIABLE', value: varName.trim() });
      continue;
    }

    // If unexpected character, advance
    i++;
  }

  return tokens;
}

/**
 * Evaluates tokens using standard Shunting-Yard & RPN evaluation.
 */
export function evaluateTokens(
  tokens: FormulaToken[], 
  scope: Record<string, number | string>
): FormulaEvaluationResult {
  const outputQueue: FormulaToken[] = [];
  const opStack: FormulaToken[] = [];

  const precedence: Record<string, number> = {
    '+': 1,
    '-': 1,
    '*': 2,
    '/': 2,
    '%': 2,
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.type === 'NUMBER') {
      outputQueue.push(token);
    } else if (token.type === 'VARIABLE') {
      const varKey = String(token.value).trim();
      // Case-insensitive lookup in scope
      const match = Object.keys(scope).find(k => k.toLowerCase() === varKey.toLowerCase());
      const rawVal = match !== undefined ? scope[match] : 0;
      const parsed = typeof rawVal === 'number' ? rawVal : parseNumericValue(rawVal);
      const numVal = parsed !== null && Number.isFinite(parsed) ? parsed : 0;
      outputQueue.push({ type: 'NUMBER', value: numVal });
    } else if (token.type === 'OPERATOR') {
      const op = String(token.value);
      while (
        opStack.length > 0 &&
        opStack[opStack.length - 1].type === 'OPERATOR' &&
        (precedence[String(opStack[opStack.length - 1].value)] || 0) >= (precedence[op] || 0)
      ) {
        outputQueue.push(opStack.pop()!);
      }
      opStack.push(token);
    } else if (token.type === 'LPAREN') {
      opStack.push(token);
    } else if (token.type === 'RPAREN') {
      while (opStack.length > 0 && opStack[opStack.length - 1].type !== 'LPAREN') {
        outputQueue.push(opStack.pop()!);
      }
      if (opStack.length === 0) return { success: false, value: 0, error: 'Mismatched parentheses' };
      opStack.pop(); // Pop LPAREN
    }
  }

  while (opStack.length > 0) {
    const top = opStack.pop()!;
    if (top.type === 'LPAREN' || top.type === 'RPAREN') {
      return { success: false, value: 0, error: 'Mismatched parentheses' };
    }
    outputQueue.push(top);
  }

  // RPN evaluation
  const valStack: number[] = [];

  for (const token of outputQueue) {
    if (token.type === 'NUMBER') {
      valStack.push(Number(token.value));
    } else if (token.type === 'OPERATOR') {
      if (valStack.length < 2) return { success: false, value: 0, error: 'Malformed expression' };
      const b = valStack.pop()!;
      const a = valStack.pop()!;
      const op = String(token.value);
      let res = 0;
      switch (op) {
        case '+': res = a + b; break;
        case '-': res = a - b; break;
        case '*': res = a * b; break;
        case '/':
          if (b === 0) {
            return { success: false, value: 0, error: 'Division by zero' };
          }
          res = a / b;
          break;
        case '%':
          res = (a * b) / 100;
          break;
        default: 
          return { success: false, value: 0, error: `Unknown operator ${op}` };
      }
      valStack.push(res);
    }
  }

  if (valStack.length !== 1) {
    return { success: false, value: 0, error: 'Invalid expression structure' };
  }

  return { success: true, value: valStack[0] };
}

/**
 * Safely parses and evaluates a formula string against a scope object.
 * Example: safeEvaluateFormula("[Price] * [Qty]", { Price: 150, Qty: 4 }) -> { success: true, value: 600 }
 */
export function safeEvaluateFormula(
  expr: string, 
  scope: Record<string, number | string>
): FormulaEvaluationResult {
  if (!expr || typeof expr !== 'string' || !expr.trim()) {
    return { success: false, value: 0, error: 'Empty formula' };
  }

  const syntaxCheck = validateFormulaSyntax(expr);
  if (!syntaxCheck.valid) {
    return { success: false, value: 0, error: syntaxCheck.error || 'Invalid formula syntax' };
  }

  try {
    const tokens = tokenizeFormula(expr);
    if (tokens.length === 0) {
      return { success: false, value: 0, error: 'No tokens found' };
    }
    return evaluateTokens(tokens, scope);
  } catch (e: any) {
    return { success: false, value: 0, error: e?.message || 'Formula evaluation error' };
  }
}
