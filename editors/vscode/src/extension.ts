import * as path from "node:path";
import { type ExtensionContext } from "vscode";
import {
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions,
	TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
	const serverModule = context.asAbsolutePath(path.join("dist", "lsp.js"));
	const serverOptions: ServerOptions = {
		run: { module: serverModule, transport: TransportKind.stdio },
		debug: { module: serverModule, transport: TransportKind.stdio },
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
