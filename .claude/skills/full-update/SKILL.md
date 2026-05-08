---
name: full-update
description: Audit and propagate a language change across the entire Espeto repo (spec, README, LSP, VSCode extension, web landing, examples, tests). Use when the user types `/full-update <descripción del cambio>` after touching the lexer, parser, evaluator, stdlib, LSP, or any user-facing surface — so nothing falls behind.
---

# /full-update

El usuario acaba de hacer un cambio en Espeto y quiere asegurarse de que **todas las superficies del proyecto queden sincronizadas**. La descripción del cambio viene en el mismo mensaje (lo que sigue a `/full-update`).

Si la descripción es vaga o ambigua, **pide clarificación antes de auditar**. Es mejor preguntar una vez que propagar mal.

## Contrato

- **Modo:** audit → propone → aplica con confirmación → verifica.
- **Read-only primero:** no edites nada hasta haber listado las inconsistencias y obtenido OK del usuario.
- **Cierre del loop:** al final corre los tests reales, no solo typecheck.

## Workflow

### 1. Clasifica el cambio

A partir de la descripción del usuario, decide qué tipo es. Pueden coincidir varios:

| Tipo | Pista típica en la descripción | Zonas afectadas |
|---|---|---|
| **builtin nuevo o modificado** | "agregué `map_with_index`", "cambié signature de `reduce`" | stdlib, manifest, highlighters, LSP completion, README, tests |
| **sintaxis nueva** | "operador `\|>>`", "nuevo keyword `defmacro`", "literal binario" | lexer, parser, evaluator, SYNTAX_MD, highlighters, LSP, tests, ejemplo |
| **feature LSP** | "inlay hints", "code actions", "nuevo diagnóstico" | `src/lsp/`, `editors/vscode/package.json` (capabilities), README sección LSP, web landing, tests LSP |
| **CLI / runtime** | "nuevo subcomando `espeto fmt`", "flag `--watch`" | `src/cli.ts`, `src/cmd.ts`, README sección comandos, web landing |
| **bump de versión** | "0.2.0", "release" | `package.json` raíz, `editors/vscode/package.json`, README "Estado actual", web landing |
| **doc-only** | "aclarar X en docs" | sólo el archivo en cuestión + propagación si afecta a otros |

Si no encaja, pregunta al usuario en qué categoría cae.

### 2. Audit (read-only)

Para cada zona afectada según el tipo, **lee** los archivos y reporta qué está desincronizado. Usa `git status` y `git diff` como punto de partida — ya hay cambios en el árbol de trabajo que dan pistas de lo que tocó el usuario.

Mapa de zonas (paths absolutos del repo):

#### Spec del lenguaje
- `src/docs.ts` — `SYNTAX_MD` hardcoded. Cambia sólo si tocaste sintaxis (operadores, keywords, control flow, comentarios, módulos, CLI blocks). **No** lleva builtins.
- `src/stdlib/*.ts` — JSDoc de los builtins (`@param`, `@returns`, `@example`, summary). Cada `BuiltinFn` exportada en `src/stdlib/index.ts` se vuelca al manifest.
- `src/stdlib/index.ts` — registry de exports. Si añadiste builtin, debe estar aquí.
- `src/lsp/generated.ts` — **generado**, no editar a mano. Se regenera con `pnpm build:manifest`.

#### README
- `/Users/hisco/repos/@hisco/espeto-language/README.md` — secciones a chequear según el cambio:
  - "Estado actual" (versión, mayo 2026 / fecha actual).
  - Sintaxis y ejemplos cortos si tocaste sintaxis.
  - Sección de stdlib si añadiste/cambiaste builtins.
  - Sección LSP / extensión si tocaste capabilities.

#### LSP
- `src/lsp/server.ts` — registro de capabilities y handlers.
- `src/lsp/completion.ts`, `signature.ts`, `diagnostics.ts`, `semantic.ts`, `symbols.ts`, `analyze.ts`.
- Si añadiste una capability nueva, refleja en `editors/vscode/package.json` (`contributes` / `semanticTokenScopes`).

#### Extensión VSCode
- `editors/vscode/package.json` — `version`, `description`, `contributes.languages`, `semanticTokenScopes`.
- `editors/vscode/syntaxes/espeto.tmLanguage.json` — patterns de keywords, types, builtins, operators. Si añadiste keyword/builtin/operador debe aparecer aquí o el highlight no funcionará.
- `editors/vscode/language-configuration.json` — comments, brackets, autoClosingPairs.
- `editors/vscode/src/extension.ts` — cliente LSP (raramente cambia).

#### Web landing
- `web/index.html` — textos, ejemplos, sección de features.
- `web/highlighter.js` — sets `KEYWORDS`, `TYPES`, `CONSTS`, `BUILTINS`, `PIPE_HELPERS`. **Crítico**: si añades builtin/keyword y olvidas el highlighter, la landing no lo colorea.
- `web/styles.css` — sólo si añades una clase de token nueva.

#### Ejemplos
- `examples/NN-*/` — cada uno con `cmd.esp` + `args.txt` (opcional) + `expected_stdout.txt`. Numeración secuencial; el siguiente número libre se asigna al nuevo ejemplo.
- Para features grandes (CLI flow, sintaxis nueva, builtin estrella) crea `examples/NN-feature/` con golden files.
- Para builtins menores: añade un test (`*_test.esp`) en un ejemplo existente o uno nuevo.

#### Tests
- `tests/lexer.test.ts`, `tests/parser.test.ts`, `tests/evaluator.test.ts`, `tests/lsp.test.ts`, `tests/repl.test.ts` — Vitest, corre con `pnpm test`.
- `examples/**/*_test.esp` — tests Espeto, corre con `./bin/espeto test examples/`.
- Asegura cobertura del cambio en al menos uno de los dos.

### 3. Propón edits

Presenta un plan de edición conciso, agrupado por zona. Ejemplo de formato:

```
Cambio: builtin `map_with_index` (lists)

Audit:
  ✓ src/stdlib/lists.ts        — implementado con JSDoc completo
  ✓ src/stdlib/index.ts        — exportado
  ✗ src/lsp/generated.ts       — desactualizado (correr `pnpm build:manifest`)
  ✗ web/highlighter.js         — falta `map_with_index` en BUILTINS
  ✗ editors/vscode/syntaxes/espeto.tmLanguage.json — falta en pattern builtins
  ✗ tests/evaluator.test.ts    — sin cobertura
  ⚠ README.md                  — la lista de builtins no es exhaustiva, no requiere edit
  ⚠ examples/                  — opcional; sugiero añadir uso en examples/08-listas/

Plan:
  1. pnpm build:manifest
  2. Añadir `"map_with_index"` a web/highlighter.js BUILTINS (línea ~32)
  3. Añadir `\\bmap_with_index\\b` al pattern builtins de tmLanguage.json
  4. Añadir test en tests/evaluator.test.ts cubriendo caso normal + lista vacía
  5. (opcional) Usarlo en examples/08-listas/cmd.esp

¿Aplico?
```

### 4. Aplica con confirmación

Después del OK, ejecuta los edits. Para cambios delicados (tmLanguage, highlighter, SYNTAX_MD) muestra el diff exacto antes de escribir.

### 5. Verifica

Corre en este orden y reporta el resultado de cada uno:

```sh
pnpm build:manifest        # regenera src/lsp/generated.ts
pnpm typecheck             # tsc --noEmit
pnpm test                  # vitest run
./bin/espeto test examples/  # tests Espeto
```

Si algún paso falla, **para** y reporta. No intentes "arreglar" el test fallido sin discutirlo — puede ser que el test esté correcto y el cambio del usuario incompleto.

Si todo pasa, resume en 1-2 frases qué quedó sincronizado.

## Comandos útiles

| Para qué | Comando |
|---|---|
| Regenerar manifest | `pnpm build:manifest` |
| Ver spec actual | `./bin/espeto docs` |
| Tests TS | `pnpm test` |
| Tests Espeto | `./bin/espeto test examples/` |
| Typecheck | `pnpm typecheck` |
| Build extensión VSCode | `cd editors/vscode && pnpm build` |
| Ver lista builtins exportados | `grep -h "^export const" src/stdlib/*.ts` |

## Reglas

- **Nunca** edites `src/lsp/generated.ts` a mano — siempre `pnpm build:manifest`.
- **Nunca** introduzcas dependencias runtime nuevas — Espeto es zero-deps en runtime.
- **Conventional Commits** en mensajes propuestos: `feat`, `fix`, `docs`, `refactor`, etc.
- Stdlib en `snake_case`, predicados terminan en `?`, sin loops.
- Si un cambio cruza varias categorías y se pone grande, **propón dividir en commits** en lugar de uno monolítico.
- Si la versión de `package.json` raíz cambió, recuerda al usuario actualizar también `editors/vscode/package.json`: la extensión versiona aparte pero suele acompañar releases mayores.
