# Espeto

> Lenguaje funcional pequeño para construir CLIs. Pipe-céntrico, Elixir-flavored, optimizado para que los LLMs lo escriban perfecto.

**Estado actual:** diseño cerrado (mayo 2026), implementación en curso.

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

  data = try file |> read |> parse_json
         rescue err => raise("No pude leer #{file}: #{err}")

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

### 2. LLM-friendly y token-económico

El lenguaje está diseñado para que un LLM lo escriba bien sin equivocarse. Eso significa:

- **Una sola forma canónica** de hacer cada cosa. Cero "hay 5 maneras de escribir lo mismo".
- **Sin coerciones implícitas**: `1 + 1.0` es error. `1 == 1.0` es `false`. Cero magia.
- **Sintaxis predecible**: siempre `def`/`defp`, siempre `do/end`, siempre `fn x => expr`.
- **Errores con posición**: cada error trae fichero, línea, columna y un caret apuntando.

### 3. CLIs como ciudadanos de primera

`cmd` es un keyword nativo, no una librería. Un fichero `.esp` con un `cmd` **es** un CLI ejecutable, con `--help` auto-generado. Sin argparse, sin boilerplate, sin import de librerías de terceros para algo que es el caso de uso #1 del lenguaje.

---

## Spec en una página

| Área | Resumen |
|---|---|
| **Top-level** | Solo `import`, `def`, `cmd`. Un `cmd` por fichero. |
| **`cmd` block** | `do/end`. Meta (`desc`/`version`) → declaraciones (`arg`/`flag`) → body. |
| **Bindings** | `x = expr` (sin `let`). Rebinding sí. Valores inmutables. |
| **Pipe `\|>`** | First-arg piping. RHS: llamada / nombre pelado / lambda / `.field`. |
| **Funciones** | `def f(x) = expr` (one-liner) o `def f(x) do ... end` (bloque). `defp` para privadas. |
| **Lambdas** | `fn x => expr`, `fn(x,y) => expr`, `fn() => expr`. Solo expresión. |
| **Errores** | Excepciones con `raise`. Auto-rescue en `cmd`. `try expr rescue err -> ...` para local. |
| **Módulos** | Fichero = módulo. Imports pelados: `import "./x" only [a, b as c]`. |
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
| **I/O** | `print`, `read`, `write`, `exists?`, `env` |
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

## Roadmap de implementación

Implementación por hitos. Cada hito = "primer programa que corre end-to-end".

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

**Estado actual: pre-hito 0.** Spec fijado, código pendiente.

---

## Stack técnico

- **TypeScript / Node 20+**
- **Tree-walking interpreter** (sin compile step a JS, sin VM intermedia)
- **Parser**: recursive descent escrito a mano
- **AST**: discriminated unions tipadas con campo `kind`
- **Source spans desde día 1**: cada token y cada nodo conocen su `{ file, line, col, length }`
- **Tooling**: `pnpm`, `tsx` (sin build step en dev), `vitest`
- **Distribución futura**: npm package compilado vía `tsc`, bin entry `espeto`

No hay async, ni FFI a JS, ni regex/HTTP/dates en v0 — Espeto es síncrono y autocontenido. Cuando madure, llegarán.

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
│   ├── repl.ts         # REPL basado en readline
│   ├── cli.ts          # bin: `espeto run|repl|...`
│   └── stdlib/
│       ├── index.ts    # prelude (auto-load)
│       └── io.ts, strings.ts, lists.ts, maps.ts, numbers.ts, json.ts
├── examples/           # cada carpeta = test integración
│   ├── 01-hello/, 02-sardinas/, ...
├── tests/              # tests TS de lexer/parser/evaluator
├── bin/espeto          # shim que lanza tsx src/cli.ts
└── package.json, tsconfig.json
```

---

## ¿Por qué "Espeto"?

Por el espeto de sardinas malagueño. La brocheta donde se asan a la brasa. La metáfora del pipe `|>` y los datos ensartados como sardinas se sostiene sola — y un nombre con sabor a Mediterráneo le sienta bien a un lenguaje pensado con cariño.

---

## Cómo arrancar

Pendiente — disponible cuando se complete el hito 0. La instalación será un `npm install -g espeto-lang` y un binario `espeto` con subcomandos `run` y `repl`.

---

## Licencia

Por definir.
