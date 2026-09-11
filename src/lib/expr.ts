/**
 * A tiny arithmetic evaluator for money fields — `+ - * / ( )` and decimals
 * only. No `eval`, no `Function`, no identifiers: anything outside that
 * grammar is rejected rather than guessed at.
 *
 * Deliberately free of `@/` runtime imports so it can be unit tested on its
 * own, without the Next.js path aliases.
 */

export type ExprResult = { ok: true; value: number } | { ok: false; error: string };

const MAX_LENGTH = 200;
const ALLOWED = /^[0-9+\-*/().\s]*$/;

class ExprError extends Error {}

/** Evaluates a `+ - * / ( )` expression and rounds the result to cents. */
export function evaluateArithmeticExpression(input: string): ExprResult {
  const source = input.trim();
  if (!source) return { ok: false, error: "Enter a number" };
  if (source.length > MAX_LENGTH) return { ok: false, error: "Expression is too long" };
  if (!ALLOWED.test(source)) return { ok: false, error: "Only numbers and + - * / ( ) are allowed" };

  let pos = 0;
  const peek = () => source[pos];
  const skipSpace = () => {
    while (source[pos] === " " || source[pos] === "\t") pos += 1;
  };

  function parseExpression(): number {
    skipSpace();
    let value = parseTerm();
    skipSpace();
    while (peek() === "+" || peek() === "-") {
      const op = source[pos];
      pos += 1;
      const rhs = parseTerm();
      value = op === "+" ? value + rhs : value - rhs;
      skipSpace();
    }
    return value;
  }

  function parseTerm(): number {
    skipSpace();
    let value = parseFactor();
    skipSpace();
    while (peek() === "*" || peek() === "/") {
      const op = source[pos];
      pos += 1;
      const rhs = parseFactor();
      if (op === "/") {
        if (rhs === 0) throw new ExprError("Can't divide by zero");
        value = value / rhs;
      } else {
        value = value * rhs;
      }
      skipSpace();
    }
    return value;
  }

  function parseFactor(): number {
    skipSpace();
    if (peek() === "+") {
      pos += 1;
      return parseFactor();
    }
    if (peek() === "-") {
      pos += 1;
      return -parseFactor();
    }
    if (peek() === "(") {
      pos += 1;
      const value = parseExpression();
      skipSpace();
      if (peek() !== ")") throw new ExprError("Missing a closing )");
      pos += 1;
      return value;
    }
    return parseNumber();
  }

  function parseNumber(): number {
    skipSpace();
    const start = pos;
    while (/[0-9]/.test(peek() ?? "")) pos += 1;
    if (peek() === ".") {
      pos += 1;
      while (/[0-9]/.test(peek() ?? "")) pos += 1;
    }
    const text = source.slice(start, pos);
    if (!text || text === ".") throw new ExprError("Expected a number");
    const value = Number(text);
    if (!Number.isFinite(value)) throw new ExprError("Expected a number");
    return value;
  }

  try {
    const value = parseExpression();
    skipSpace();
    if (pos !== source.length) return { ok: false, error: "Unexpected character" };
    if (!Number.isFinite(value)) return { ok: false, error: "That doesn't compute" };
    return { ok: true, value: Math.round((value + Number.EPSILON) * 100) / 100 };
  } catch (err) {
    return { ok: false, error: err instanceof ExprError ? err.message : "That doesn't compute" };
  }
}

/**
 * The same evaluator, tolerant of how money is typically typed into a money
 * field — a leading/embedded `$` and thousands commas — and constrained to a
 * value a ledger can hold (finite, not negative).
 */
export function evaluateMoneyExpression(raw: string): ExprResult {
  const stripped = raw.replaceAll("$", "").replaceAll(",", "");
  if (!stripped.trim()) return { ok: false, error: "Enter a number" };
  const result = evaluateArithmeticExpression(stripped);
  if (!result.ok) return result;
  if (result.value < 0) return { ok: false, error: "Enter a positive amount" };
  return result;
}
