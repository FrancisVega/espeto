import type { FnDoc } from "./lsp/manifest-types";
import { MANIFEST } from "./lsp/generated";

const SYNTAX_MD = `## Syntax

### Comments
\`# line comment\` — to end of line.

\`## doc text\` (two hashes followed by a space or end-of-line) on the
line(s) immediately above a \`def\` or \`defp\` is a **doc-comment**: the
content (markdown) is captured and shown in LSP hover. A run of
consecutive \`##\` lines attaches to the \`def\` below; a blank line or
any \`#\` comment between the run and the \`def\` breaks the attachment
(orphan docs are silently ignored). For multi-paragraph docs, use \`##\`
alone (empty content) as a separator. Anything else starting with \`##\`
(like \`###\` or \`##X\` without a space) is a regular comment.

### Literals
- int: \`42\`, \`-1\`, \`1_000_000\` (underscores allowed)
- float: \`3.14\`, \`-0.5\` (digit on both sides of \`.\`)
- str: \`"hi"\`, \`"hola, #{name}!"\` (double quotes; \`#{...}\` interpolates an expression; escapes: \`\\n \\t \\r \\\\ \\" \\#\`)
- bool: \`true\`, \`false\`
- nil: \`nil\`
- list: \`[1, 2, 3]\`
- map: \`{a: 1, b: 2}\` — access fields with dot: \`m.a\`

### Operators
- arithmetic: \`+ - * /\` (use builtin \`mod\` for modulo, \`div\` for integer division)
- comparison: \`== < <= > >=\` (no \`!=\`; use \`not (a == b)\`; comparisons cannot be chained, use \`and\`)
- logical: \`and\`, \`or\`, \`not\` (words, not symbols)
- pipe: \`x |> f\` is sugar for \`f(x)\`; \`x |> f(a)\` is \`f(x, a)\` (always passes \`x\` as the first argument)

### Bindings
\`x = 1\` — local binding inside a block. No \`let\`/\`var\` keyword.

### Conditionals
\`\`\`
if cond do
  ...
else
  ...
end
\`\`\`
\`if\` is an expression — its value is the last expression in the chosen branch.

### Functions
\`\`\`
## Greet someone by name.
##
## Returns "Hola, NAME!".
def name(a, b) do
  ...
end
defp helper(x) do  # private to this module
  ...
end
\`\`\`
The last expression in the body is the return value. \`##\` lines
immediately above a \`def\`/\`defp\` are captured as a doc-comment and
shown in LSP hover (see Comments).

### Lambdas
\`fn x => x + 1\`. Multi-arg: \`fn (x, y) => x + y\`. Lambdas are values: pass to \`map\`, \`filter\`, \`reduce\`, etc.

### Try / rescue
\`\`\`
result = try do
  to_int(s)
rescue err =>
  0
end
\`\`\`
The body runs as a block; if anything raises, control jumps to the \`rescue\` arm with the message bound to \`err\`. Use \`raise("msg")\` to raise. Bang variants (\`sh!\`, \`to_int\`) raise on failure; non-bang variants return error-shaped maps or wrapped values instead.

### Predicate (\`?\`) and bang (\`!\`) suffixes
Identifiers may end with \`?\` (predicate, returns bool) or \`!\` (raises on failure). Convention from Ruby/Elixir. Examples: \`is_int?\`, \`exists?\`, \`sh!\`, \`assert_raise\`.

### Imports
\`\`\`
import "./util" only [trim, upcase]
import "./long/module/name" as M
\`\`\`
Paths are relative to the importing file. \`only\` whitelists names. \`as\` aliases the module so you can call \`M.upcase(x)\`.

### Special variables
- \`_\` — discard binding (e.g. \`rescue _ => "fallback"\`).
- \`__file__\` — absolute path of the source file as string.
- \`__dir__\` — absolute path of the directory containing the source file.

### CLI blocks
Single-command file:
\`\`\`
cmd greet do
  desc "say hello"
  arg name: str
  flag loud: bool = false

  msg = "Hola, #{name}!"
  msg |> when(loud, upcase) |> print
end
\`\`\`

Multi-command program:
\`\`\`
program todo do
  desc "tiny todo manager"
  version "0.1.0"
  flag verbose: bool = false

  cmd add do
    desc "add an item"
    arg item: str
    "added: #{item}" |> print
  end

  cmd remove do
    desc "remove by id"
    arg id: int
    "removed: #{id}" |> print
  end
end
\`\`\`

\`arg name: type\` declares positional args. \`flag name: type = default\` declares flags. Types: \`str\`, \`int\`, \`float\`, \`bool\`. Args/flags become bindings inside the cmd body.

### Test files
Files ending in \`_test.esp\` use a different shape:
\`\`\`
test "two plus two is four" do
  assert 2 + 2 == 4
end

test "raises on bad input" do
  assert_raise(fn => parse(""), "expected non-empty")
end
\`\`\`
Run with \`espeto test [path]\`. \`assert\` is a keyword with introspection on failure. \`AssertionError\` is not catchable by user \`try/rescue\`.
`;

export function buildDocs(now: Date = new Date()): string {
	const header = renderHeader(now);
	const stdlib = renderStdlib();
	return `${header}\n${SYNTAX_MD}\n${stdlib}`;
}

function renderHeader(now: Date): string {
	return [
		`# Espeto v${MANIFEST.version} reference`,
		"",
		"Espeto is a small functional language for building CLIs.",
		`Generated ${now.toISOString()}.`,
		"",
	].join("\n");
}

function renderStdlib(): string {
	const fns = Object.values(MANIFEST.functions);
	const modules = [...new Set(fns.map((f) => f.module))].sort();
	const out: string[] = [];
	for (const m of modules) {
		out.push(`## ${m}`, "");
		const modFns = fns
			.filter((f) => f.module === m)
			.sort((a, b) => a.name.localeCompare(b.name));
		for (const fn of modFns) {
			out.push(renderFn(fn));
		}
	}
	return out.join("\n");
}

function renderFn(fn: FnDoc): string {
	const params = fn.params.map((p) => `${p.name}: ${p.type}`).join(", ");
	const sig = `${fn.name}(${params}) -> ${fn.returns.type}`;
	const example = fn.examples[0] ?? "";
	return [`### \`${sig}\``, fn.summary, "", "```", example, "```", ""].join(
		"\n",
	);
}
