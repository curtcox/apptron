export const examples = [
  { id: 'hello-shell', title: 'Hello, Linux', language: 'Shell', description: 'Start with a shell, a file, and a tiny welcome script.' },
  { id: 'go-hello', title: 'A little Go', language: 'Go', description: 'Load the offline Go toolchain and compile your first program.' },
  { id: 'python', title: 'Python playground', language: 'Python', description: 'A prebuilt Python overlay. No package downloads inside the VM.' },
  { id: 'c-make', title: 'C, meet Make', language: 'C', description: 'Compile a C program with the offline build tools overlay.' },
  { id: 'node', title: 'Node in a tab', language: 'JavaScript', description: 'Run JavaScript with Node and npm already installed.' },
  { id: 'esbuild', title: 'Bundle something', language: 'JavaScript', description: 'Turn two JavaScript modules into one with the built-in esbuild.' },
  { id: 'wasm', title: 'Hello, WebAssembly', language: 'Wasm', description: 'Execute a small WASI binary natively through Apptron.' },
  { id: 'fun', title: 'Terminal diversions', language: 'Shell', description: 'Cowsay, figlet, and a train. A little room to play.' },
  { id: 'envbuild', title: 'Build your environment', language: 'Shell', description: 'Install a package with an envbuild script and your own network relay.', needsRelay: true }
];
export async function loadExample(id) {
  if (!examples.some(e => e.id === id)) throw new Error('Unknown gallery example.');
  const response = await fetch(new URL(`../examples/${id}.txtar`, import.meta.url));
  if (!response.ok) throw new Error('Could not load this example.');
  return response.text();
}
