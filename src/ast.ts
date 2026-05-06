import type { Span } from "./errors";

export type Expr =
	| StringExpr
	| IntLiteral
	| FloatLiteral
	| BoolLiteral
	| NilLiteral
	| Identifier
	| Call
	| BinaryOp
	| UnaryOp
	| IfExpr
	| LambdaExpr
	| ListExpr
	| MapExpr
	| FieldAccess
	| FieldShorthand
	| TryExpr;

export type BinaryOpKind =
	| "+"
	| "-"
	| "*"
	| "/"
	| "=="
	| "<"
	| "<="
	| ">"
	| ">="
	| "and"
	| "or";

export type UnaryOpKind = "-" | "not";

export type BinaryOp = {
	kind: "binop";
	op: BinaryOpKind;
	lhs: Expr;
	rhs: Expr;
	span: Span;
};

export type UnaryOp = {
	kind: "unop";
	op: UnaryOpKind;
	operand: Expr;
	span: Span;
};

export type IfBranch = {
	cond: Expr;
	body: Expr;
};

export type IfExpr = {
	kind: "if";
	branches: IfBranch[];
	elseBody?: Expr;
	span: Span;
};

export type LambdaExpr = {
	kind: "lambda";
	params: string[];
	body: Expr;
	span: Span;
};

export type ListExpr = {
	kind: "list";
	items: Expr[];
	span: Span;
};

export type MapEntry = {
	key: string;
	keySpan: Span;
	value: Expr;
};

export type MapExpr = {
	kind: "map";
	entries: MapEntry[];
	span: Span;
};

export type FieldAccess = {
	kind: "field_access";
	target: Expr;
	field: string;
	fieldSpan: Span;
	span: Span;
};

export type FieldShorthand = {
	kind: "field_shorthand";
	field: string;
	span: Span;
};

export type TryExpr = {
	kind: "try";
	tryBody: Stmt[];
	errBinding: string;
	errBindingSpan: Span;
	rescueBody: Stmt[];
	span: Span;
};

export type StringExpr = {
	kind: "string";
	parts: (string | Expr)[];
	span: Span;
};

export type IntLiteral = {
	kind: "int";
	value: number;
	span: Span;
};

export type FloatLiteral = {
	kind: "float";
	value: number;
	span: Span;
};

export type BoolLiteral = {
	kind: "bool";
	value: boolean;
	span: Span;
};

export type NilLiteral = {
	kind: "nil";
	span: Span;
};

export type Identifier = {
	kind: "ident";
	name: string;
	span: Span;
};

export type Call = {
	kind: "call";
	callee: Expr;
	args: Expr[];
	span: Span;
};

export type FnDef = {
	kind: "fn_def";
	name: string;
	params: string[];
	body: Stmt[];
	exported: boolean;
	span: Span;
};

export type AssignStmt = {
	kind: "assign";
	name: string;
	value: Expr;
	span: Span;
};

export type Stmt = AssignStmt | Expr;

export type CliType = "str" | "int" | "float" | "bool";

export type DeclAttrs = {
	short?: string;
	desc?: string;
};

export type ArgDecl = {
	kind: "arg_decl";
	name: string;
	type: CliType;
	default?: Expr;
	attrs: DeclAttrs;
	span: Span;
};

export type FlagDecl = {
	kind: "flag_decl";
	name: string;
	type: CliType;
	default?: Expr;
	attrs: DeclAttrs;
	span: Span;
};

export type MetaStmt = {
	kind: "meta_desc" | "meta_version";
	value: Expr;
	span: Span;
};

export type Cmd = {
	kind: "cmd";
	name: string;
	meta: MetaStmt[];
	decls: (ArgDecl | FlagDecl)[];
	body: Stmt[];
	span: Span;
};

export type ImportSelector = {
	name: string;
	nameSpan: Span;
	as?: string;
	asSpan?: Span;
};

export type ImportItem = {
	kind: "import";
	path: string;
	pathSpan: Span;
	only?: ImportSelector[];
	span: Span;
};

export type Item = FnDef | AssignStmt | Cmd | Expr | ImportItem;

export type Program = {
	kind: "program";
	items: Item[];
	span: Span;
};
