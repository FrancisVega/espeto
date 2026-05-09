# Espeto

> Lenguaje funcional pequeño para construir CLIs. Pipe-céntrico, Elixir-flavored, optimizado para que los LLMs lo escriban perfecto.

**Estado actual:** **v0.1.0 publicado** (mayo 2026). Build, watch, REPL, LSP + extensión VS Code, multi-subcomando, identificadores mágicos `__file__`/`__dir__`. Sistema de paquetes con resolver walking-upward: `import "name"` busca `packages/<name>/<name>.esp` (primer paquete: `ansi`). Próximo: `pnpm publish` v0.2.0.

---

## La idea

"Espeto" en el sur de España es la brocheta donde se ensartan sardinas para asarlas a la brasa. La metáfora del lenguaje es exactamente esa:

- Las **sardinas** son los datos.
- El **espeto** es el operador pipe `|>`.
- Un programa idiomático se lee como una brocheta: el dato entra por un lado, sale transformado por el otro.

```espeto
"sardinas" |> upcase |> print
```

Eso ya es un programa válido en Espeto.

---

## Echa un vistazo

### Hola pipe

```espeto
"hola" |> print
```

### Encadena transformaciones

```espeto
"  sardinas frescas  " |> trim |> upcase |> print
# SARDINAS FRESCAS
```

### Define funciones

```espeto
def saludar(name) = "Hola, #{name}!"

"mundo" |> saludar |> print
# Hola, mundo!
```

### Un CLI completo en 6 líneas

`hola.esp`:

```espeto
cmd hola do
  arg name: str
  flag loud: bool = false

  greeting = "Hola, #{name}!"
  greeting |> when(loud, upcase) |> print
end
```

Y se ejecuta:

```sh
espeto run hola.esp -- --name Mundo --loud
# HOLA, MUNDO!

espeto run hola.esp -- --help
# (auto-generado a partir de las declaraciones)
```

### CLI multi-subcomando con `program`

Un solo fichero puede agrupar varios subcomandos con flags compartidas:

```espeto
program todo do
  desc "todo manager"
  version "0.1.0"
  flag loud: bool = false

  cmd add do
    arg item: str
    "added: #{item}" |> when(loud, upcase) |> print
  end

  cmd remove do
    arg id: int
    "removed: #{id}" |> print
  end
end
```

```sh
espeto run todo.esp -- add milk
# added: milk
espeto run todo.esp -- --loud add milk
# ADDED: MILK
espeto run todo.esp -- --help
# Usage: todo <command> [options]
# Commands: add, remove
# ...
```

`--help` y `--version` salen gratis. Cada subcomando hereda las flags del `program`.

### Modo watch

Re-ejecuta el programa cada vez que cambia el fichero o cualquiera de sus imports relativos:

```sh
espeto run --watch hola.esp -- --name Mundo
# ▸ ran in 2ms — watching 1 file
# (editas hola.esp y guarda)
# ▸ ran in 1ms — watching 1 file
```

También funciona como `-w`. Sigue corriendo hasta `Ctrl-C`. Los errores de parseo o runtime no matan el watcher; el siguiente cambio relanza.

### CLI realista con JSON, filtros y manejo de errores

`users.esp`:

```espeto
import "./format" only [bullet]

cmd users do
  desc "Lista usuarios activos desde un fichero JSON. Filtra por edad mínima."
  version "0.1.0"

  arg file: str, desc: "ruta al fichero JSON"
  flag min_age: int = 0, short: "a", desc: "edad mínima"
  flag loud: bool = false, short: "l", desc: "saluda gritando"

  data = try do
    file |> read |> parse_json
  rescue err =>
    raise("No pude leer #{file}: #{err}")
  end

  data
    |> filter(fn u => u.active and u.age >= min_age)
    |> sort_by(.age)
    |> map(.name)
    |> map(fn n => saludar(n, loud))
    |> each(fn s => bullet(s) |> print)
end

def saludar(name, loud) do
  base = "Hola, #{name}!"
  if loud do upcase(base) else base end
end
```

`format.esp`:

```espeto
def bullet(s) = "• #{s}"
```

---

## Filosofía de diseño

Espeto se construye sobre tres ideas que se sostienen unas a otras:

### 1. Pipe-céntrico

El operador `|>` no es uno más: es la columna vertebral. Todo programa idiomático fluye datos de izquierda a derecha. La sintaxis está optimizada para que el pipe sea **siempre** la opción más cómoda.

A la derecha del `|>` puedes poner:
- una llamada con argumentos: `x |> f(y)` ≡ `f(x, y)`
- un nombre pelado (función arity-1): `x |> upcase` ≡ `upcase(x)`
- una lambda inline: `x |> (fn n => n * 2)`
- un acceso a campo: `user |> .name` ≡ `user.name`
- una llamada con **placeholder `_`** para colocar el LHS en otra posición: `6 |> div(30, _)` ≡ `div(30, 6)`

### 2. LLM-friendly y token-económico

El lenguaje está diseñado para que un LLM lo escriba bien sin equivocarse. Eso significa:

- **Una sola forma canónica** de hacer cada cosa. Cero "hay 5 maneras de escribir lo mismo".
- **Sin coerciones implícitas**: `1 + 1.0` es error. `1 == 1.0` es `false`. Cero magia.
- **Sintaxis predecible**: siempre `def`/`defp`, siempre `do/end`, siempre `fn x => expr`.
- **Errores con posición**: cada error trae fichero, línea, columna y un caret apuntando.

#### Spec en un comando: `espeto docs`

`espeto docs` imprime la referencia completa del lenguaje en markdown a stdout (sintaxis, operadores, control flow, todos los builtins con signature + ejemplo). Pensado para que un LLM aprenda Espeto sin leer el repo.

```sh
# Pegarlo a un chat
espeto docs | pbcopy

# Snapshot versionado para tu proyecto
espeto docs > spec.md
```

**Patrón en tu proyecto Espeto:** añade un `CLAUDE.md` o `AGENTS.md` que apunte a `spec.md`, y refrescalo con `espeto docs > spec.md` cuando subas de versión. Así tu LLM tiene la referencia del lenguaje siempre a mano y no improvisa sintaxis.

### 3. CLIs como ciudadanos de primera

`cmd` es un keyword nativo, no una librería. Un fichero `.esp` con un `cmd` **es** un CLI ejecutable, con `--help` auto-generado. Sin argparse, sin boilerplate, sin import de librerías de terceros para algo que es el caso de uso #1 del lenguaje.

---

## Spec en una página

| Área | Resumen |
|---|---|
| **Top-level** | `import`, `def`/`defp`, `cmd`, `program`. Un `cmd` o `program` por fichero. |
| **`cmd` block** | `do/end`. Meta (`desc`/`version`) → declaraciones (`arg`/`flag`) → body. |
| **`program` block** | Agrupa varios `cmd` como subcomandos con flags compartidas. `--help`/`--version` auto. |
| **Bindings** | `x = expr` (sin `let`). Rebinding sí. Valores inmutables. |
| **Pipe `\|>`** | First-arg piping. RHS: llamada / nombre pelado / lambda / `.field`. Placeholder `_` para reposicionar LHS. |
| **Funciones** | `def f(x) = expr` (one-liner) o `def f(x) do ... end` (bloque). `defp` para privadas. |
| **Lambdas** | `fn x => expr`, `fn(x,y) => expr`, `fn() => expr`. Solo expresión. |
| **Errores** | Excepciones con `raise`. Auto-rescue en `cmd`. `try do ... rescue err => ... end` para local. Variantes `try_*` para Result-style. |
| **Módulos** | Fichero = módulo. Imports pelados: `import "./x" only [a, b as c]`. |
| **Source bindings** | `__file__` / `__dir__` auto-inyectados por módulo (definition-site, closure-captured). |
| **Tipos** | `int`, `float`, `str`, `bool`, `nil`, `list`, `map`, `fn`. Sin coerción. |
| **Igualdad** | `==` único, estructural. `1 == 1.0` es false. |
| **Truthiness** | Estricto: solo `bool` en `if`. `and`/`or`/`not` requieren bool. |
| **Control** | Solo `if/else if/else do…end`, expresión-valuada. Sin ternario, sin `case` en v0. |
| **Strings** | `"..."` con `#{x}`. Comentarios `#`. (Multilínea `"""..."""` planeado para v1.) |
| **Concat** | Solo funciones (`concat`, `join`). Sin operadores `<>`/`++`. |
| **Stdlib** | ~50-60 funcs auto-cargadas. `snake_case`. `?` en predicados. Sin loops. Sync. |

---

## Stdlib v0 (auto-cargada)

| Categoría | Funciones |
|---|---|
| **I/O** | `print`, `read`, `try_read`, `write`, `try_write`, `exists?`, `env`, `env_or` |
| **Strings** | `upcase`, `downcase`, `trim`, `split`, `join`, `replace`, `length`, `starts_with?`, `ends_with?`, `contains?` |
| **Números** | `to_int`, `to_float`, `to_str`, `abs`, `round`, `floor`, `ceil`, `min`, `max`, `div`, `mod` |
| **Listas** | `length`, `head`, `tail`, `concat`, `map`, `filter`, `reduce`, `each`, `find`, `sort`, `sort_by`, `reverse`, `take`, `drop`, `unique`, `range`, `zip` |
| **Maps** | `keys`, `values`, `get`, `get_or`, `put`, `delete`, `has_key?`, `merge` |
| **JSON** | `parse_json`, `to_json` |
| **Pipe helpers** | `when`, `unless`, `id` |
| **Predicados de tipo** | `is_int?`, `is_float?`, `is_str?`, `is_bool?`, `is_nil?`, `is_list?`, `is_map?`, `is_fn?` |
| **Errores** | `raise`, variantes `try_*` para Result-style |

**Lo que NO hay en v0** (pero está planteado para v1+): pattern matching, regex, HTTP, fechas, async, tuples, atoms, TCO garantizado.

---

## Identificadores mágicos: `__file__` / `__dir__`

Cada módulo `.esp` tiene dos bindings auto-inyectados con el path absoluto del fichero fuente:

```esp
cmd active_users do
  users = parse_json(read("#{__dir__}/users.json"))
  users |> filter(.active) |> map(.name) |> each(print)
end
```

- **Definition-site / closure**: si `lib.esp` define `def data_path() = "#{__dir__}/data"`, al importar y llamar desde otro módulo, `__dir__` resuelve al dir de `lib.esp` (donde vive el texto), no al del importador.
- **REPL**: no están bindeados (no hay archivo asociado). Acceso → `undefined: __file__`.
- **Built binaries (`espeto build`)**: los paths preservan los valores de build-time. Para shippear data junto al binario, compón en runtime con `process.cwd()`-relative o variables de entorno.

---

## Roadmap

### Hitos completados (v0.1.0)

| Hito | Deliverable |
|---|---|
| **0** | Setup proyecto: pnpm + tsx + vitest, layout, errors con source spans, bin |
| **1** | `"hola" \|> print` corre — lexer, parser, evaluator base, primer builtin |
| **2** | `"x" \|> upcase \|> print` — más builtins, chains de pipes |
| **3** | `def f(x) = ...` + uso — funciones de usuario, scope, llamadas |
| **4** | `hola.esp` completo — `cmd`, `arg`, `flag`, interpolación, `when` |
| **5** | `espeto repl` — REPL con env persistente |
| **6** | Imports + módulo separado — `import "./x" only [..]`, resolución de paths |
| **7** | Control flow + listas + maps + lambdas — `if/else`, literales, acceso a campos |
| **8** | `users.esp` completo — JSON, `sort_by`, `.field`, `try/rescue`, stdlib amplia |
| **9** | Errores formateados pretty — source spans con snippet + caret |

### Post-v0.1.0 (en `main`)

- `espeto build` — empaquetado standalone vía Bun `--compile`
- `espeto run --watch` — re-ejecución on-change
- `espeto lsp` — servidor LSP por stdio + extensión VS Code (`editors/vscode/`)
- `program <name>` — multi-subcomando con flags compartidas
- Pipe placeholder `_` — reposicionar LHS en cualquier argumento
- `__file__` / `__dir__` — paths source-relative por módulo
- Stdlib JSDoc → manifest → hover docs en LSP

### Próximo

- v0.2.0 publicado a npm (`pnpm publish`)
- v1: transpiler `.esp → .js` (AOT real, sin runtime embebido)
- v1: regex, HTTP, fechas, pattern matching, async

---

## Stack técnico

- **TypeScript / Node 20+**
- **Tree-walking interpreter** (sin compile step a JS, sin VM intermedia)
- **Parser**: recursive descent escrito a mano
- **AST**: discriminated unions tipadas con campo `kind`
- **Source spans desde día 1**: cada token y cada nodo conocen su `{ file, line, col, length }`
- **Tooling**: `pnpm`, `tsx` (sin build step en dev), `vitest` (~770 tests)
- **Build de la CLI**: `esbuild` bundle → `dist/cli.js`, `dist/runtime.js`, `dist/lsp.js`
- **Build de programas `.esp`**: `espeto build` → Bun `--compile` (binario autocontenido)

No hay async, ni FFI a JS, ni regex/HTTP/dates en v0 — Espeto es síncrono y autocontenido. v1 traerá AOT real (transpiler `.esp → .js`) y los features pendientes.

---

## Estructura del proyecto

```
espeto-language/
├── src/
│   ├── lexer.ts        # tokenizer + posiciones
│   ├── parser.ts       # recursive descent → AST
│   ├── ast.ts          # tipos discriminated unions
│   ├── evaluator.ts    # tree-walking interpreter
│   ├── env.ts          # entornos / scoping
│   ├── errors.ts       # EspetoError con source span
│   ├── values.ts       # representación runtime de valores
│   ├── cmd.ts          # parseo argv → args/flags + help auto
│   ├── imports.ts      # ModuleLoader, resolver, source bindings
│   ├── run.ts          # entry point del runtime
│   ├── watch.ts        # `espeto run --watch`
│   ├── repl.ts         # REPL basado en readline
│   ├── cli.ts          # bin: `espeto run|build|repl|lsp|...`
│   ├── build.ts        # `espeto build`: empaqueta .esp en binario via Bun
│   ├── lsp/            # servidor LSP (stdio) + análisis para hover/go-to-def
│   │   └── server.ts, analyze.ts, generated.ts (manifest auto)
│   └── stdlib/         # prelude auto-cargado, JSDoc → hover docs
│       └── index.ts, io.ts, strings.ts, lists.ts, maps.ts, numbers.ts, json.ts, pipe.ts, ...
├── editors/vscode/     # extensión VS Code (LSP client + grammar)
├── scripts/build-manifest.ts  # extrae JSDoc de stdlib → MANIFEST para LSP
├── examples/           # cada carpeta = test integración (01-hello/ ... 14-file/)
├── tests/              # ~770 tests vitest
├── bin/espeto          # shim que lanza tsx src/cli.ts
└── package.json, tsconfig.json
```

---

## ¿Por qué "Espeto"?

Por el espeto de sardinas malagueño. La brocheta donde se asan a la brasa. La metáfora del pipe `|>` y los datos ensartados como sardinas se sostiene sola — y un nombre con sabor a Mediterráneo le sienta bien a un lenguaje pensado con cariño.

---

## Cómo arrancar

Desde fuente (npm publish llega en v0.2.0):

```sh
git clone https://github.com/<...>/espeto-language.git
cd espeto-language
pnpm install
pnpm build

./bin/espeto run examples/01-hello/cmd.esp
./bin/espeto repl
```

Subcomandos:

```
espeto run [-w|--watch] <file.esp> [-- cmd-args...]   ejecuta un .esp
espeto build <file.esp> -o <out> [--target T]          empaqueta en binario standalone
espeto test [-w|--watch] [path]                        corre *_test.esp bajo path
espeto docs                                            imprime referencia del lenguaje (markdown)
espeto repl                                            REPL interactivo
espeto lsp                                             servidor LSP (stdio)
espeto --help / --version
```

---

## Editor support

### LSP

`espeto lsp` arranca un servidor LSP por stdio. Capacidades:

- **Hover**: docs Markdown sobre builtins (signature + summary + ejemplos), funciones locales, args, flags, locales, params de lambda/fn, `__file__`/`__dir__`.
- **Go to definition**: builtins (a un stub generado), funciones locales, args, flags, locales.
- **Diagnostics en vivo**: errores de lex/parse publicados en cada cambio de documento.
- **Completion** scope-aware: keywords + builtins (con docs) + locales del cmd/fn actual (args, flags, params, lets).
- **Find references** y **Rename** simbólico: lets, fns top-level, args, flags, params de fn/lambda y rescue err.
- **Document symbols** (Outline) y **Folding ranges** para `cmd`/`fn`/`program`/`test`/`try` y lambdas multilínea.
- **Signature help** al teclear `(` o `,` para builtins y fns user.
- **Semantic tokens** (`function`/`parameter`/`variable` con modifier `defaultLibrary`) para coloreado contextual.

Las docs de stdlib se extraen del JSDoc en `src/stdlib/*.ts` vía `pnpm build:manifest` y se compilan en `src/lsp/generated.ts`.

### VS Code extension

En `editors/vscode/`. Arranca `espeto lsp` y aplica grammar de syntax highlighting:

```sh
cd editors/vscode
pnpm install
pnpm package    # genera espeto-*.vsix
code --install-extension espeto-*.vsix
```

---

## Distribuir como binario

Un programa `.esp` se puede empaquetar en un ejecutable standalone que **no requiere Node ni espeto en la máquina destino**:

```sh
espeto build hola.esp -o hola
./hola Mundo --loud
# HOLA, MUNDO!
```

Resuelve recursivamente todos los `import "./..."`, así que un programa multi-fichero se empaqueta entero en un solo binario.

### Cross-compilar

```sh
espeto build hola.esp -o hola --target linux-arm64
```

Targets soportados: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `windows-x64`. Default: la plataforma actual.

### Requisitos y caveats

- Necesita [Bun](https://bun.sh) instalado en la máquina donde haces el build (no en la destino). `espeto build` lo invoca por debajo.
- **No es un compilador AOT**: el binario embebe el intérprete + tu fuente `.esp` y la evalúa en runtime. Funcionalmente es una distribución autocontenida, no código nativo.
- Tamaño típico: ~55-90 MB por binario (Bun runtime embebido).

---

## Licencia

Por definir.
