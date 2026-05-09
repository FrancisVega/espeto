// Espeto syntax highlighter
// Tokenizer + renderer. Applied to <pre><code class="lang-espeto">.
//
// Tokens emitted:
//   keyword     — import, def, defp, cmd, arg, flag, do, end, fn, if, else,
//                 try, rescue, and, or, not, desc, version, only, as, return
//   type        — int, float, str, bool, nil, list, map
//   const       — true, false, nil
//   builtin     — stdlib functions (print, upcase, map, ...)
//   pipe-helper — when, unless, id, raise (slightly different from regular builtins)
//   string      — string contents
//   string-quote
//   number
//   comment
//   pipe        — |>
//   arrow       — => (lambda body, rescue handler)
//   op          — = == != <= >= < > + - * /
//   punct       — ( ) { } [ ] , ;
//   dot         — . (field access)
//   colon
//   interp-open  — #{
//   interp-close — }
//   ident       — fallback
//   ws

(function () {
  const KEYWORDS = new Set([
    "import", "def", "defp", "cmd", "arg", "flag", "do", "end", "fn",
    "if", "else", "try", "rescue", "and", "or", "not",
    "desc", "version", "only", "as",
  ]);

  const TYPES = new Set(["int", "float", "str", "bool", "nil", "list", "map"]);

  const CONSTS = new Set(["true", "false", "nil"]);

  const PIPE_HELPERS = new Set(["when", "unless", "id", "raise"]);

  const BUILTINS = new Set([
    // I/O
    "print", "read", "write", "exists?", "env", "env_or", "tty?",
    // Strings
    "upcase", "downcase", "trim", "split", "join", "replace", "length",
    "starts_with?", "ends_with?", "contains?",
    // Numbers
    "to_int", "to_float", "to_str", "abs", "round", "floor", "ceil",
    "min", "max", "div", "mod",
    // Lists
    "head", "tail", "concat", "map", "filter", "reduce", "each", "find",
    "sort", "sort_by", "reverse", "take", "drop", "take_while", "drop_while",
    "unique", "range", "zip",
    // Maps
    "keys", "values", "get", "get_or", "put", "delete", "has_key?", "merge",
    // JSON
    "parse_json", "to_json",
    // Type predicates
    "is_int?", "is_float?", "is_str?", "is_bool?", "is_nil?",
    "is_list?", "is_map?", "is_fn?", "is_stream?",
    // Streams
    "read_lines", "stdin_lines", "sh_lines", "collect", "count",
    // Shell
    "sh", "sh!",
    // Try variants
    "try_read", "try_write", "try_parse_json", "try_to_int", "try_to_float",
    // Asserts
    "assert_raise",
  ]);

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isIdentStart(ch) {
    return /[a-zA-Z_]/.test(ch);
  }

  function isIdentPart(ch) {
    return /[a-zA-Z0-9_]/.test(ch);
  }

  function isDigit(ch) {
    return ch >= "0" && ch <= "9";
  }

  // Tokenize a fragment of normal espeto source (no enclosing string).
  function tokenize(src) {
    const tokens = [];
    let i = 0;
    const n = src.length;

    while (i < n) {
      const ch = src[i];

      // whitespace
      if (/\s/.test(ch)) {
        let j = i;
        while (j < n && /\s/.test(src[j])) j++;
        tokens.push({ type: "ws", value: src.slice(i, j) });
        i = j;
        continue;
      }

      // comment: # ... end of line
      if (ch === "#") {
        let j = i;
        while (j < n && src[j] !== "\n") j++;
        tokens.push({ type: "comment", value: src.slice(i, j) });
        i = j;
        continue;
      }

      // multi-line string """..."""
      if (ch === '"' && src[i + 1] === '"' && src[i + 2] === '"') {
        const start = i;
        let j = i + 3;
        while (j < n) {
          if (src[j] === '"' && src[j + 1] === '"' && src[j + 2] === '"') {
            j += 3;
            break;
          }
          if (src[j] === "\\" && j + 1 < n) {
            j += 2;
            continue;
          }
          j++;
        }
        tokens.push(...tokenizeString(src.slice(start, j)));
        i = j;
        continue;
      }

      // single-line string "..."
      if (ch === '"') {
        const start = i;
        let j = i + 1;
        while (j < n && src[j] !== '"') {
          if (src[j] === "\\" && j + 1 < n) {
            j += 2;
            continue;
          }
          j++;
        }
        if (j < n) j++; // closing quote
        tokens.push(...tokenizeString(src.slice(start, j)));
        i = j;
        continue;
      }

      // numbers
      if (isDigit(ch)) {
        let j = i;
        while (j < n && (isDigit(src[j]) || src[j] === "_")) j++;
        if (src[j] === "." && isDigit(src[j + 1])) {
          j++;
          while (j < n && (isDigit(src[j]) || src[j] === "_")) j++;
        }
        tokens.push({ type: "number", value: src.slice(i, j) });
        i = j;
        continue;
      }

      // pipe |>
      if (ch === "|" && src[i + 1] === ">") {
        tokens.push({ type: "pipe", value: "|>" });
        i += 2;
        continue;
      }

      // arrow => (lambda body, rescue handler)
      if (ch === "=" && src[i + 1] === ">") {
        tokens.push({ type: "arrow", value: "=>" });
        i += 2;
        continue;
      }

      // multi-char comparison operators
      const two = src.slice(i, i + 2);
      if (two === "==" || two === "!=" || two === "<=" || two === ">=") {
        tokens.push({ type: "op", value: two });
        i += 2;
        continue;
      }

      // single-char operators
      if ("+-*/=<>".includes(ch)) {
        tokens.push({ type: "op", value: ch });
        i++;
        continue;
      }

      // punctuation
      if ("(){}[],;".includes(ch)) {
        tokens.push({ type: "punct", value: ch });
        i++;
        continue;
      }

      // dot — field access
      if (ch === ".") {
        tokens.push({ type: "dot", value: "." });
        i++;
        continue;
      }

      // colon
      if (ch === ":") {
        tokens.push({ type: "colon", value: ":" });
        i++;
        continue;
      }

      // identifier / keyword
      if (isIdentStart(ch)) {
        let j = i;
        while (j < n && isIdentPart(src[j])) j++;
        if (src[j] === "?" || src[j] === "!") j++;
        const word = src.slice(i, j);

        let type = "ident";
        if (KEYWORDS.has(word)) type = "keyword";
        else if (TYPES.has(word)) type = "type";
        else if (CONSTS.has(word)) type = "const";
        else if (PIPE_HELPERS.has(word)) type = "pipe-helper";
        else if (BUILTINS.has(word)) type = "builtin";

        tokens.push({ type, value: word });
        i = j;
        continue;
      }

      // unknown char — pass through
      tokens.push({ type: "ident", value: ch });
      i++;
    }

    return tokens;
  }

  // Tokenize the contents of a string literal, expanding #{...} interpolations.
  // The input includes the quotes (single " or triple """).
  function tokenizeString(raw) {
    const tokens = [];
    let i = 0;
    const n = raw.length;

    // detect triple vs single quote
    const isTriple = raw.startsWith('"""');
    const quoteLen = isTriple ? 3 : 1;
    const quote = isTriple ? '"""' : '"';

    // opening quote
    tokens.push({ type: "string-quote", value: quote });
    i = quoteLen;

    let buf = "";

    function flush() {
      if (buf.length) {
        tokens.push({ type: "string", value: buf });
        buf = "";
      }
    }

    while (i < n) {
      // closing quote
      if (isTriple) {
        if (raw[i] === '"' && raw[i + 1] === '"' && raw[i + 2] === '"') {
          break;
        }
      } else {
        if (raw[i] === '"') break;
      }

      // escape
      if (raw[i] === "\\" && i + 1 < n) {
        buf += raw.slice(i, i + 2);
        i += 2;
        continue;
      }

      // interpolation #{...}
      if (raw[i] === "#" && raw[i + 1] === "{") {
        flush();
        tokens.push({ type: "interp-open", value: "#{" });
        let depth = 1;
        let j = i + 2;
        while (j < n && depth > 0) {
          if (raw[j] === "{") depth++;
          else if (raw[j] === "}") {
            depth--;
            if (depth === 0) break;
          }
          j++;
        }
        const inner = raw.slice(i + 2, j);
        tokens.push(...tokenize(inner));
        tokens.push({ type: "interp-close", value: "}" });
        i = j + 1;
        continue;
      }

      buf += raw[i];
      i++;
    }

    flush();

    if (i < n) {
      tokens.push({ type: "string-quote", value: quote });
    }

    return tokens;
  }

  // Some identifiers are user-defined functions; if we see `def NAME` or
  // `defp NAME` or `cmd NAME`, mark the following ident as a definition.
  // Also: identifier followed by `(` is a function call (already gets default
  // ident color, but we can mark it as `fn-call` for a slight emphasis).
  function refine(tokens) {
    for (let i = 0; i < tokens.length; i++) {
      const tk = tokens[i];
      if (tk.type !== "keyword") continue;
      if (tk.value !== "def" && tk.value !== "defp" && tk.value !== "cmd") continue;

      // skip whitespace, find next ident
      let j = i + 1;
      while (j < tokens.length && tokens[j].type === "ws") j++;
      if (j < tokens.length && tokens[j].type === "ident") {
        tokens[j].type = "fn-name";
      }
    }
    return tokens;
  }

  function render(tokens) {
    return tokens
      .map((t) => {
        if (t.type === "ws") return escapeHtml(t.value);
        return `<span class="tk-${t.type}">${escapeHtml(t.value)}</span>`;
      })
      .join("");
  }

  function highlight(code) {
    const trimmed = code.replace(/^\n+|\s+$/g, "");
    const tokens = refine(tokenize(trimmed));
    return render(tokens);
  }

  function applyHighlighting() {
    const blocks = document.querySelectorAll("pre code.lang-espeto");
    blocks.forEach((el) => {
      if (el.dataset.highlighted === "true") return;
      const source = el.textContent;
      el.innerHTML = highlight(source);
      el.dataset.highlighted = "true";
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyHighlighting);
  } else {
    applyHighlighting();
  }

  // Export for inline use (hero)
  window.EspetoHighlight = { highlight };
})();
