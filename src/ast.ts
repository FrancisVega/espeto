import type { Span } from "./errors";

export type Comment = {
	text: string;
	span: Span;
};

export type Expr =
	| StringExpr
	| IntLiteral
	| FloatLiteral
	| BoolLiteral
	| NilLiteral
	| Identifier
	| Call
	| PipeExpr
	| BinaryOp
	| UnaryOp
	| IfExpr
	| LambdaExpr
	| ListExpr
	| MapExpr
	| FieldAccess
	| FieldShorthand
	| TryExpr
	| AssertExpr;

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
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type UnaryOp = {
	kind: "unop";
	op: UnaryOpKind;
	operand: Expr;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
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
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type LambdaExpr = {
	kind: "lambda";
	params: string[];
	paramSpans?: Span[];
	body: Expr;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type ListExpr = {
	kind: "list";
	items: Expr[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
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
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type FieldAccess = {
	kind: "field_access";
	target: Expr;
	field: string;
	fieldSpan: Span;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type FieldShorthand = {
	kind: "field_shorthand";
	field: string;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type TryExpr = {
	kind: "try";
	tryBody: Stmt[];
	errBinding: string;
	errBindingSpan: Span;
	rescueBody: Stmt[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
	tryDanglingComments?: Comment[];
	rescueDanglingComments?: Comment[];
};

export type AssertExpr = {
	kind: "assert";
	expr: Expr;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type TestBlock = {
	kind: "test";
	name: string;
	nameSpan: Span;
	body: Stmt[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type StringExpr = {
	kind: "string";
	parts: (string | Expr)[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type IntLiteral = {
	kind: "int";
	value: number;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type FloatLiteral = {
	kind: "float";
	value: number;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type BoolLiteral = {
	kind: "bool";
	value: boolean;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type NilLiteral = {
	kind: "nil";
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type Identifier = {
	kind: "ident";
	name: string;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type Call = {
	kind: "call";
	callee: Expr;
	args: Expr[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type PipeExpr = {
	kind: "pipe";
	lhs: Expr;
	rhs: Call;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type FnDef = {
	kind: "fn_def";
	name: string;
	nameSpan?: Span;
	params: string[];
	paramSpans?: Span[];
	body: Stmt[];
	exported: boolean;
	doc?: string;
	docSpan?: Span;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type AssignStmt = {
	kind: "assign";
	name: string;
	value: Expr;
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
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
	nameSpan?: Span;
	type: CliType;
	default?: Expr;
	attrs: DeclAttrs;
	span: Span;
};

export type FlagDecl = {
	kind: "flag_decl";
	name: string;
	nameSpan?: Span;
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
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type ProgramDecl = {
	kind: "program";
	name: string;
	meta: MetaStmt[];
	flags: FlagDecl[];
	cmds: Cmd[];
	span: Span;
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
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
	leadingComments?: Comment[];
	trailingComment?: Comment;
	leadingBlankLine?: boolean;
	danglingComments?: Comment[];
};

export type Item =
	| FnDef
	| AssignStmt
	| Cmd
	| ProgramDecl
	| Expr
	| ImportItem
	| TestBlock;

export type Module = {
	kind: "module";
	items: Item[];
	span: Span;
	danglingComments?: Comment[];
};
