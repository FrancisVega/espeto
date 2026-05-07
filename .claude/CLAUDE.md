# Espeto language repo

Repo del lenguaje Espeto. Para conocer la sintaxis y todos los builtins:

```sh
./bin/espeto docs
```

Imprime ~750 líneas de markdown con la referencia completa (sintaxis, operadores, control flow, builtins con signature + ejemplo). Generado desde `src/docs.ts` + JSDoc de `src/stdlib/*.ts`.

## Layout

- `src/` — lexer, parser, evaluator, LSP, stdlib (TypeScript, zero-deps en runtime).
- `src/stdlib/` — builtins. JSDoc → `src/lsp/generated.ts` (manifest) → hover docs en LSP.
- `examples/NN-*/` — ejemplos numerados con golden files (`args.txt` + `expected_stdout.txt`). Los `*_test.esp` son tests unitarios que corre `espeto test`.
- `tests/` — tests TS (Vitest) del compilador y runtime.
- `bin/espeto` — wrapper que invoca `src/cli.ts`.

## Comandos útiles

- `pnpm test` — tests TS del compilador.
- `./bin/espeto test examples/` — tests Espeto (`*_test.esp`).
- `./bin/espeto docs` — referencia del lenguaje.

## Convenciones

- Conventional Commits.
- Zero-deps en runtime (filosofía explícita; no añadir deps sin discutir).
- Stdlib `snake_case`, `?` en predicados, síncrona, sin loops.
- Una sola forma canónica de hacer cada cosa (LLM-friendly).
