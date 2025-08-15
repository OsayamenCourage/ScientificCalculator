/* =====================================================
   Scientific Calculator - Vanilla JS
   - Builds an expression string from user input
   - Converts to a safe JS expression for evaluation
   - Supports DEG/RAD trigonometry, memory, factorial
   - Keyboard shortcuts for common keys
   ===================================================== */

/* ---------------------
   DOM element handles
   --------------------- */
const historyEl = document.getElementById('history');
const resultEl = document.getElementById('result');
const buttons = document.querySelectorAll('.controls .btn');
const angleToggleBtn = document.getElementById('angle-toggle');

/* ---------------------
   Calculator state
   --------------------- */
let expr = '';           // Expression string displayed in history
let lastResult = null;   // Store last evaluated number
let angleMode = 'DEG';   // 'DEG' or 'RAD'
let memory = 0;          // Memory register

/* ---------------------
   Helper: update display
   --------------------- */
function updateDisplay() {
  historyEl.textContent = expr;
  resultEl.textContent = lastResult !== null ? String(lastResult) : (expr ? '' : '0');
}

/* ---------------------
   Angle mode toggle
   --------------------- */
function toggleAngleMode() {
  angleMode = angleMode === 'DEG' ? 'RAD' : 'DEG';
  angleToggleBtn.textContent = angleMode;
}

/* ---------------------
   Token append helpers
   --------------------- */
function appendValue(value) {
  // Prevent two operators in a row (except minus for negative after operator or '(')
  const lastChar = expr.slice(-1);

  const operators = ['+', '-', '×', '÷', '^'];
  if (operators.includes(value)) {
    if (expr === '' && value !== '-') return; // do not allow starting with operator except minus
    if (operators.includes(lastChar)) {
      // Replace last operator if two in a row (allow negative numbers after operator or '(')
      if (value === '-' && (lastChar === '(' || operators.includes(lastChar))) {
        expr += value; // allow negative sign
      } else {
        expr = expr.slice(0, -1) + value;
      }
      updateDisplay();
      return;
    }
  }

  // Avoid duplicate decimal in the current number
  if (value === '.') {
    const tail = getTrailingNumberToken(expr);
    if (tail.includes('.')) return;
  }

  // Auto-insert multiplication for cases like "2(" or ")3" or "π3" or "e("
  if (needsImplicitMultiply(lastChar, value)) {
    expr += '×';
  }

  expr += value;
  updateDisplay();
}

function needsImplicitMultiply(prev, next) {
  const isLeft = /[\d\)\!]|\bπ|\be/.test(prev);
  const isRight = /[\d\(]|π|e|[a-zA-Z√]/.test(next);
  // If left is number/)/!/π/e and right is number/(/π/e/function => imply multiplication
  return prev && isLeft && isRight;
}

/* ---------------------
   Backspace and clear
   --------------------- */
function backspace() {
  if (!expr) return;
  // Handle trimming function names like "sin(" as one unit if cursor is right after "("
  const fnNames = ['sin(', 'cos(', 'tan(', 'ln(', 'log(', '√('];
  for (const fn of fnNames) {
    if (expr.endsWith(fn)) {
      expr = expr.slice(0, -fn.length);
      updateDisplay();
      return;
    }
  }
  expr = expr.slice(0, -1);
  updateDisplay();
}

function clearAll() {
  expr = '';
  lastResult = null;
  updateDisplay();
}

/* ---------------------
   Sign toggle and percent
   --------------------- */
function toggleSign() {
  const { start, token } = getTrailingNumber(expr);
  if (!token) return;
  // Wrap the number in (-number)
  const before = expr.slice(0, start);
  const replaced = `(-${token})`;
  expr = before + replaced;
  updateDisplay();
}

function percent() {
  const { start, token } = getTrailingNumber(expr);
  if (!token) return;
  const before = expr.slice(0, start);
  const replaced = `(${token}/100)`;
  expr = before + replaced;
  updateDisplay();
}

/* ---------------------
   Memory operations
   --------------------- */
function memoryOperation(op) {
  // Use the lastResult if available, otherwise try to evaluate current expr
  let valueToUse = lastResult;
  if (valueToUse === null && expr) {
    const evaluated = safeEvaluate(expr);
    if (evaluated.ok) valueToUse = evaluated.value;
  }

  switch (op) {
    case 'MC':
      memory = 0;
      break;
    case 'MR':
      if (expr && /[\d\)]$/.test(expr)) expr += '×'; // implicit multiply before memory recall if needed
      expr += String(memory);
      updateDisplay();
      return;
    case 'M+':
      if (typeof valueToUse === 'number') memory += valueToUse;
      break;
    case 'M-':
      if (typeof valueToUse === 'number') memory -= valueToUse;
      break;
  }
  // Indicate memory briefly (optional: could flash UI)
}

/* ---------------------
   Evaluation pipeline
   --------------------- */
function evaluateExpression() {
  if (!expr) return;
  const evaluated = safeEvaluate(expr);
  if (evaluated.ok) {
    lastResult = evaluated.value;
    updateDisplay();
    // After equals, allow chaining: start new expr with result
    expr = String(lastResult);
  } else {
    // Show error briefly
    resultEl.textContent = 'Error';
    // Keep expr so user can fix it
  }
}

/* Convert our human-readable expr to a safe JS expression */
function toJSExpression(src) {
  let s = src;

  // Replace constants and operators
  s = s.replaceAll('×', '*')
       .replaceAll('÷', '/')
       .replaceAll('π', 'Math.PI')
       .replaceAll('e', 'Math.E')
       .replaceAll('^', '**')
       .replaceAll('√(', 'Math.sqrt(');

  // Replace function names with our function wrapper (for DEG/RAD, etc.)
  s = s.replaceAll('sin(', 'fn.sin(')
       .replaceAll('cos(', 'fn.cos(')
       .replaceAll('tan(', 'fn.tan(')
       .replaceAll('ln(', 'Math.log(')   // natural log
       .replaceAll('log(', 'fn.log10('); // base-10 log

  // Replace postfix factorial: "5!" => fn.fact(5), "(... )!" => fn.fact(...)
  s = replaceFactorials(s);

  return s;
}

/* Replace factorial postfix using a repeated regex approach */
function replaceFactorials(input) {
  // Matches either a number (with optional decimal) or parentheses group, followed by !
  // Example: 5! or (3+2)!
  const re = /(\d+(?:\.\d+)?|\([^()]*\))!/g;
  let prev;
  let out = input;
  // Repeat until no further replacement (handles nested like (3+2)!^2)
  do {
    prev = out;
    out = out.replace(re, (_, term) => `fn.fact(${term})`);
  } while (out !== prev);
  return out;
}

/* Evaluate expression safely using Function ctor and limited scope */
function safeEvaluate(sourceExpr) {
  try {
    const jsExpr = toJSExpression(sourceExpr);

    // Function namespace for trig and factorial
    const fn = {
      // Trig functions respect angle mode
      sin: (x) => Math.sin(angleMode === 'DEG' ? (x * Math.PI) / 180 : x),
      cos: (x) => Math.cos(angleMode === 'DEG' ? (x * Math.PI) / 180 : x),
      tan: (x) => Math.tan(angleMode === 'DEG' ? (x * Math.PI) / 180 : x),

      // Base-10 log
      log10: (x) => Math.log10 ? Math.log10(x) : (Math.log(x) / Math.LN10),

      // Factorial for non-negative integers; for non-integers, uses Gamma approximation (Lanczos)
      fact: (n) => {
        if (Number.isInteger(n)) {
          if (n < 0) throw new Error('Factorial of negative');
          if (n > 170) throw new Error('Overflow'); // beyond this Infinity in JS
          let f = 1;
          for (let i = 2; i <= n; i++) f *= i;
          return f;
        } else {
          // Gamma(n+1) approximation via Lanczos
          return gamma(n + 1);
        }
      },
    };

    // Lanczos approximation for the Gamma function
    function gamma(z) {
      const p = [
        676.5203681218851,  -1259.1392167224028,
        771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012,
        9.9843695780195716e-6, 1.5056327351493116e-7
      ];
      const g = 7;
      if (z < 0.5) {
        // Reflection formula
        return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
      }
      z -= 1;
      let x = 0.99999999999980993;
      for (let i = 0; i < p.length; i++) {
        x += p[i] / (z + i + 1);
      }
      const t = z + g + 0.5;
      return Math.sqrt(2 * Math.PI) * t ** (z + 0.5) * Math.exp(-t) * x;
    }

    // Use Function with only Math and fn in scope, not global window
    // eslint-disable-next-line no-new-func
    const evaluator = new Function('Math', 'fn', `return (${jsExpr});`);
    const value = evaluator(Math, fn);

    if (!Number.isFinite(value)) throw new Error('Non-finite result');
    return { ok: true, value: roundForDisplay(value) };
  } catch (e) {
    console.warn('Evaluation error:', e);
    return { ok: false, error: e };
  }
}

/* Round results nicely for display, avoiding floating noise */
function roundForDisplay(num) {
  // Use 12 significant digits, remove trailing zeros
  const s = Number(num).toPrecision(12);
  const n = Number(s);
  return Math.abs(n) < 1e-12 ? 0 : n;
}

/* ---------------------
   Trailing token helpers
   --------------------- */
// Returns the entire trailing number (with optional decimal) for % and ±
function getTrailingNumber(str) {
  const m = str.match(/(\d+(\.\d+)?)(?=[^\d.]*$)/);
  if (!m) return { start: -1, token: '' };
  const token = m[1];
  const start = str.lastIndexOf(token);
  return { start, token };
}

// Returns trailing number token string only
function getTrailingNumberToken(str) {
  const { token } = getTrailingNumber(str);
  return token || '';
}

/* ---------------------
   Event handling
   --------------------- */
buttons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    const value = btn.dataset.value;

    switch (type) {
      case 'mode':
        toggleAngleMode();
        break;

      case 'digit':
      case 'operator':
      case 'paren':
      case 'const':
        appendValue(value);
        break;

      case 'func':
        // Append function with opening parenthesis; auto-multiply if needed
        appendValue(value);
        break;

      case 'postfix': // factorial "!"
        // Append "!" only if expression ends with a number, ")" or "!" already
        if (/[0-9\)]$/.test(expr) || expr.endsWith('!')) {
          expr += '!';
          updateDisplay();
        }
        break;

      case 'dot':
        appendValue('.');
        break;

      case 'percent':
        percent();
        break;

      case 'sign':
        toggleSign();
        break;

      case 'backspace':
        backspace();
        break;

      case 'clear':
        clearAll();
        break;

      case 'memory':
        memoryOperation(value);
        break;

      case 'equals':
        evaluateExpression();
        break;
    }
  });
});

/* Keyboard support: digits, operators, parentheses, Enter, Backspace, Delete */
window.addEventListener('keydown', (e) => {
  const k = e.key;

  // Allow simple inputs
  if (/\d/.test(k)) {
    appendValue(k);
    return;
  }
  if (k === '.') {
    appendValue('.');
    return;
  }

  // Operators
  if (k === '+') { appendValue('+'); return; }
  if (k === '-') { appendValue('-'); return; }
  if (k === '*') { appendValue('×'); return; }
  if (k === '/') { appendValue('÷'); return; }
  if (k === '^') { appendValue('^'); return; }

  // Parentheses
  if (k === '(' || k === ')') { appendValue(k); return; }

  // Evaluate
  if (k === 'Enter' || k === '=') {
    e.preventDefault();
    evaluateExpression();
    return;
  }

  // Edits
  if (k === 'Backspace') { backspace(); return; }
  if (k === 'Delete') { clearAll(); return; }

  // Percent and sign toggle shortcuts
  if (k === '%') { percent(); return; }
  if (k === '_') { toggleSign(); return; } // Shift + '-' on some layouts
});

/* Initialize display at start */
updateDisplay();
