import type { ExtensionContext } from "vscode";
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(_context: ExtensionContext): void {
	const serverOptions: ServerOptions = {
		run: { command: "espeto", args: ["lsp"], transport: TransportKind.stdio },
		debug: { command: "espeto", args: ["lsp"], transport: TransportKind.stdio },
	};
	const clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: "file", language: "espeto" }],
		synchronize: {},
	};
	client = new LanguageClient(
		"espeto",
		"Espeto Language Server",
		serverOptions,
		clientOptions,
	);
	client.start();
}

export function deactivate(): Thenable<void> | undefined {
	return client?.stop();
}
