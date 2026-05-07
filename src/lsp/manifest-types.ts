export type Param = { name: string; type: string; doc: string };
export type Returns = { type: string; doc: string };

export type FnDoc = {
	name: string;
	module: string;
	summary: string;
	description: string;
	params: Param[];
	returns: Returns;
	examples: string[];
	definedAt: { file: string; line: number };
	stubLine: number;
};

export type Manifest = {
	version: string;
	generatedAt: string;
	functions: Record<string, FnDoc>;
};
