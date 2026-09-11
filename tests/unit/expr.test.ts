import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateArithmeticExpression, evaluateMoneyExpression, type ExprResult } from "../../src/lib/expr.ts";

function ok(result: ExprResult): number {
  assert.ok(result.ok, "error" in result ? result.error : undefined);
  return result.value;
}

function failed(result: ExprResult): void {
  assert.equal(result.ok, false);
}

test("basic arithmetic", () => {
  assert.equal(ok(evaluateArithmeticExpression("4.3*150")), 645);
  assert.equal(ok(evaluateArithmeticExpression("30+5")), 35);
  assert.equal(ok(evaluateArithmeticExpression("120/3")), 40);
  assert.equal(ok(evaluateArithmeticExpression("(20+5)*2")), 50);
});

test("operator precedence and parentheses nest", () => {
  assert.equal(ok(evaluateArithmeticExpression("2+3*4")), 14);
  assert.equal(ok(evaluateArithmeticExpression("(2+3)*4")), 20);
  assert.equal(ok(evaluateArithmeticExpression("((1+2)*(3+4))")), 21);
  assert.equal(ok(evaluateArithmeticExpression("-5+10")), 5);
});

test("division by zero is rejected, not Infinity or NaN", () => {
  failed(evaluateArithmeticExpression("10/0"));
});

test("malformed expressions are rejected", () => {
  failed(evaluateArithmeticExpression("4.3**"));
  failed(evaluateArithmeticExpression("(20+5"));
  failed(evaluateArithmeticExpression("20+5)"));
  failed(evaluateArithmeticExpression(""));
  failed(evaluateArithmeticExpression("   "));
});

test("anything beyond plain arithmetic is rejected, not evaluated as code", () => {
  failed(evaluateArithmeticExpression("abc"));
  failed(evaluateArithmeticExpression("Math.random()"));
  failed(evaluateArithmeticExpression("function(){}"));
  failed(evaluateArithmeticExpression("variable"));
  failed(evaluateArithmeticExpression("NaN"));
  failed(evaluateArithmeticExpression("Infinity"));
  failed(evaluateArithmeticExpression("1e10"));
});

test("money expressions tolerate $ and commas, and reject negative results", () => {
  assert.equal(ok(evaluateMoneyExpression("$4.3*150")), 645);
  assert.equal(ok(evaluateMoneyExpression("1,200+50")), 1250);
  failed(evaluateMoneyExpression("5-10"));
});
