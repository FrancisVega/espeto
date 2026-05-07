import { floatToString } from "../evaluator";
import {
	type BuiltinFn,
	isBuiltin,
	isList,
	isMap,
	isStream,
	isUserFn,
	type MapValue,
	type Value,
	typeName,
} from "../values";
import { wrapResult } from "./errors";

class JsonParser {
	private i = 0;
	constructor(private src: string) {}

	parse(): Value {
		this.skipWs();
		const v = this.parseValue();
		this.skipWs();
		if (this.i !== this.src.length) {
			this.fail(`unexpected character after value`);
		}
		return v;
	}

	private parseValue(): Value {
		this.skipWs();
		if (this.i >= this.src.length) this.fail("unexpected end of input");
		const c = this.src[this.i]!;
		if (c === "{") return this.parseObject();
		if (c === "[") return this.parseArray();
		if (c === '"') return this.parseString();
		if (c === "t" || c === "f") return this.parseBool();
		if (c === "n") return this.parseNull();
		if (c === "-" || (c >= "0" && c <= "9")) return this.parseNumber();
		this.fail(`unexpected character: ${JSON.stringify(c)}`);
	}

	private parseObject(): MapValue {
		this.i++; // consume {
		const entries: Record<string, Value> = {};
		this.skipWs();
		if (this.src[this.i] === "}") {
			this.i++;
			return { kind: "map", entries };
		}
		while (true) {
			this.skipWs();
			if (this.src[this.i] !== '"') this.fail("expected string key");
			const key = this.parseString();
			this.skipWs();
			if (this.src[this.i] !== ":") this.fail("expected ':'");
			this.i++;
			const v = this.parseValue();
			entries[key] = v;
			this.skipWs();
			const sep = this.src[this.i];
			if (sep === ",") {
				this.i++;
				continue;
			}
			if (sep === "}") {
				this.i++;
				return { kind: "map", entries };
			}
			this.fail("expected ',' or '}'");
		}
	}

	private parseArray(): Value[] {
		this.i++; // consume [
		const out: Value[] = [];
		this.skipWs();
		if (this.src[this.i] === "]") {
			this.i++;
			return out;
		}
		while (true) {
			out.push(this.parseValue());
			this.skipWs();
			const sep = this.src[this.i];
			if (sep === ",") {
				this.i++;
				continue;
			}
			if (sep === "]") {
				this.i++;
				return out;
			}
			this.fail("expected ',' or ']'");
		}
	}

	private parseString(): string {
		this.i++; // consume opening "
		let out = "";
		while (this.i < this.src.length) {
			const c = this.src[this.i]!;
			if (c === '"') {
				this.i++;
				return out;
			}
			if (c === "\\") {
				this.i++;
				const esc = this.src[this.i];
				if (esc === undefined) this.fail("unterminated escape");
				this.i++;
				switch (esc) {
					case '"':
						out += '"';
						break;
					case "\\":
						out += "\\";
						break;
					case "/":
						out += "/";
						break;
					case "b":
						out += "\b";
						break;
					case "f":
						out += "\f";
						break;
					case "n":
						out += "\n";
						break;
					case "r":
						out += "\r";
						break;
					case "t":
						out += "\t";
						break;
					case "u": {
						const hex = this.src.slice(this.i, this.i + 4);
						if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
							this.fail("invalid \\u escape");
						}
						out += String.fromCharCode(Number.parseInt(hex, 16));
						this.i += 4;
						break;
					}
					default:
						this.fail(`invalid escape: \\${esc}`);
				}
				continue;
			}
			if (c.charCodeAt(0) < 0x20) {
				this.fail("control character in string");
			}
			out += c;
			this.i++;
		}
		this.fail("unterminated string");
	}

	private parseNumber(): bigint | number {
		const start = this.i;
		if (this.src[this.i] === "-") this.i++;
		// integer part
		if (this.src[this.i] === "0") {
			this.i++;
		} else if (this.src[this.i] && this.src[this.i]! >= "1" && this.src[this.i]! <= "9") {
			while (
				this.src[this.i] &&
				this.src[this.i]! >= "0" &&
				this.src[this.i]! <= "9"
			) {
				this.i++;
			}
		} else {
			this.fail("invalid number");
		}
		let isFloat = false;
		if (this.src[this.i] === ".") {
			isFloat = true;
			this.i++;
			if (
				!this.src[this.i] ||
				this.src[this.i]! < "0" ||
				this.src[this.i]! > "9"
			) {
				this.fail("invalid number: digit expected after '.'");
			}
			while (
				this.src[this.i] &&
				this.src[this.i]! >= "0" &&
				this.src[this.i]! <= "9"
			) {
				this.i++;
			}
		}
		if (this.src[this.i] === "e" || this.src[this.i] === "E") {
			isFloat = true;
			this.i++;
			if (this.src[this.i] === "+" || this.src[this.i] === "-") this.i++;
			if (
				!this.src[this.i] ||
				this.src[this.i]! < "0" ||
				this.src[this.i]! > "9"
			) {
				this.fail("invalid number: digit expected in exponent");
			}
			while (
				this.src[this.i] &&
				this.src[this.i]! >= "0" &&
				this.src[this.i]! <= "9"
			) {
				this.i++;
			}
		}
		const lex = this.src.slice(start, this.i);
		return isFloat ? Number.parseFloat(lex) : BigInt(lex);
	}

	private parseBool(): boolean {
		if (this.src.startsWith("true", this.i)) {
			this.i += 4;
			return true;
		}
		if (this.src.startsWith("false", this.i)) {
			this.i += 5;
			return false;
		}
		this.fail("expected 'true' or 'false'");
	}

	private parseNull(): null {
		if (this.src.startsWith("null", this.i)) {
			this.i += 4;
			return null;
		}
		this.fail("expected 'null'");
	}

	private skipWs(): void {
		while (this.i < this.src.length) {
			const c = this.src[this.i]!;
			if (c === " " || c === "\t" || c === "\n" || c === "\r") {
				this.i++;
				continue;
			}
			break;
		}
	}

	private fail(msg: string): never {
		throw new Error(`parse_json: ${msg} at position ${this.i}`);
	}
}

/**
 * Parse a JSON string into Espeto values.
 * Numbers without a decimal become int; with a decimal or exponent become float.
 * Errors on invalid JSON. Use `try_parse_json` for a result-wrapped variant.
 *
 * @param {str} s - the JSON source
 * @returns {any} the parsed value (str, int, float, bool, nil, list or map)
 *
 * @example
 * parse_json("{\"a\": 1}") // => {a: 1}
 */
export const parse_json: BuiltinFn = {
	kind: "builtin",
	name: "parse_json",
	arity: 1,
	call: (args) => {
		const v = args[0] ?? null;
		if (typeof v !== "string") {
			throw new Error(`parse_json: expected str, got ${typeName(v)}`);
		}
		return new JsonParser(v).parse();
	},
};

/**
 * Result-wrapped variant of `parse_json`. Returns `{ok: true, value: any}`
 * on success or `{ok: false, error: str}` on failure.
 *
 * @param {str} s - the JSON source
 * @returns {map} `{ok, value}` or `{ok, error}`
 *
 * @example
 * try_parse_json("not json") // => {ok: false, error: "parse_json: ..."}
 */
export const try_parse_json = wrapResult("try_parse_json", parse_json);

const MAX_SAFE = 9007199254740991n; // 2^53 - 1
const MIN_SAFE = -9007199254740991n;

function valueToJson(v: Value): string {
	if (v === null) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "string") return JSON.stringify(v);
	if (typeof v === "bigint") {
		if (v > MAX_SAFE || v < MIN_SAFE) {
			throw new Error(
				`to_json: int ${v} exceeds safe range (±2^53-1), would lose precision`,
			);
		}
		return v.toString();
	}
	if (typeof v === "number") {
		if (!Number.isFinite(v)) {
			throw new Error(`to_json: cannot serialize ${v}`);
		}
		return floatToString(v);
	}
	if (isList(v)) {
		return `[${v.map(valueToJson).join(",")}]`;
	}
	if (isMap(v)) {
		const parts = Object.keys(v.entries).map(
			(k) => `${JSON.stringify(k)}:${valueToJson(v.entries[k]!)}`,
		);
		return `{${parts.join(",")}}`;
	}
	if (isStream(v)) {
		throw new Error(
			"to_json: streams cannot be serialized (use collect first)",
		);
	}
	if (isBuiltin(v) || isUserFn(v)) {
		throw new Error("to_json: cannot serialize fn");
	}
	throw new Error(`to_json: cannot serialize ${typeName(v)}`);
}

/**
 * Serialize an Espeto value to a compact JSON string.
 * Errors on functions or ints outside the IEEE-754 safe range (±2^53-1).
 *
 * @param {any} v - the value to serialize
 * @returns {str} the JSON string
 *
 * @example
 * to_json({a: [1, 2]}) // => "{\"a\":[1,2]}"
 */
export const to_json: BuiltinFn = {
	kind: "builtin",
	name: "to_json",
	arity: 1,
	call: (args) => valueToJson(args[0] ?? null),
};
