import type { Env } from "../env";
import { assert_raise } from "./assert";
import { raise, try_to_float, try_to_int } from "./errors";
import {
	env_or,
	env_var,
	exists,
	print,
	read,
	try_read,
	try_write,
	write,
} from "./io";
import { parse_json, to_json, try_parse_json } from "./json";
import {
	concat,
	drop,
	drop_while,
	each,
	filter,
	find,
	head,
	length,
	map,
	range,
	reduce,
	reverse,
	sort,
	sort_by,
	tail,
	take,
	take_while,
	unique,
	zip,
} from "./lists";
import {
	del as map_delete,
	get,
	get_or,
	has_key,
	keys,
	merge,
	put,
	values,
} from "./maps";
import {
	abs,
	ceil,
	div,
	floor,
	max,
	min,
	mod,
	round,
	to_float,
	to_int,
	to_str,
} from "./numbers";
import { id, unless, when } from "./pipe";
import { sh, sh_bang } from "./sh";
import {
	is_bool,
	is_fn,
	is_float,
	is_int,
	is_list,
	is_map,
	is_nil,
	is_str,
	is_stream,
} from "./predicates";
import {
	collect,
	count,
	read_lines,
	sh_lines,
	stdin_lines,
} from "./streams";
import {
	contains,
	downcase,
	ends_with,
	join,
	replace,
	split,
	starts_with,
	trim,
	upcase,
} from "./strings";

export function loadPrelude(env: Env): void {
	env.define("print", print);
	env.define("read", read);
	env.define("try_read", try_read);
	env.define("write", write);
	env.define("try_write", try_write);
	env.define("exists?", exists);
	env.define("env", env_var);
	env.define("env_or", env_or);
	env.define("parse_json", parse_json);
	env.define("try_parse_json", try_parse_json);
	env.define("to_json", to_json);
	env.define("upcase", upcase);
	env.define("downcase", downcase);
	env.define("trim", trim);
	env.define("split", split);
	env.define("join", join);
	env.define("replace", replace);
	env.define("starts_with?", starts_with);
	env.define("ends_with?", ends_with);
	env.define("contains?", contains);
	env.define("when", when);
	env.define("unless", unless);
	env.define("id", id);
	env.define("div", div);
	env.define("mod", mod);
	env.define("abs", abs);
	env.define("round", round);
	env.define("floor", floor);
	env.define("ceil", ceil);
	env.define("min", min);
	env.define("max", max);
	env.define("to_int", to_int);
	env.define("to_float", to_float);
	env.define("to_str", to_str);
	env.define("length", length);
	env.define("head", head);
	env.define("tail", tail);
	env.define("map", map);
	env.define("filter", filter);
	env.define("reduce", reduce);
	env.define("each", each);
	env.define("concat", concat);
	env.define("reverse", reverse);
	env.define("take", take);
	env.define("drop", drop);
	env.define("take_while", take_while);
	env.define("drop_while", drop_while);
	env.define("find", find);
	env.define("sort", sort);
	env.define("sort_by", sort_by);
	env.define("unique", unique);
	env.define("range", range);
	env.define("zip", zip);
	env.define("keys", keys);
	env.define("values", values);
	env.define("get", get);
	env.define("get_or", get_or);
	env.define("put", put);
	env.define("delete", map_delete);
	env.define("has_key?", has_key);
	env.define("merge", merge);
	env.define("is_int?", is_int);
	env.define("is_float?", is_float);
	env.define("is_str?", is_str);
	env.define("is_bool?", is_bool);
	env.define("is_nil?", is_nil);
	env.define("is_list?", is_list);
	env.define("is_map?", is_map);
	env.define("is_fn?", is_fn);
	env.define("is_stream?", is_stream);
	env.define("read_lines", read_lines);
	env.define("stdin_lines", stdin_lines);
	env.define("sh_lines", sh_lines);
	env.define("collect", collect);
	env.define("count", count);
	env.define("raise", raise);
	env.define("try_to_int", try_to_int);
	env.define("try_to_float", try_to_float);
	env.define("assert_raise", assert_raise);
	env.define("sh", sh);
	env.define("sh!", sh_bang);
}
