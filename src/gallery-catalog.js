// Generated from the app-owned examples.
export const catalog=[
  {
    "id": "hello-shell",
    "title": "Hello, Linux",
    "language": "Shell",
    "description": "Start with a shell, a file, and a tiny welcome script.",
    "tags": [
      "Shell"
    ],
    "document": {
      "src": "# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\necho\necho \"Hello from a real Linux VM.\"\necho \"Try: sh hello.sh\"\necho\n-- hello.sh --\n#!/bin/sh\nprintf 'Hello, %s!\\n' \"${1:-Apptron}\"\nprintf 'Kernel: '; uname -sr\nprintf 'Project files:\\n'; ls -la /project\n"
    }
  },
  {
    "id": "go-hello",
    "title": "A little Go",
    "language": "Go",
    "description": "Load the offline Go toolchain and compile your first program.",
    "tags": [
      "Go"
    ],
    "document": {
      "src": "# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\n# Go links executables with mmap; its build directory needs a native tmpfs.\nmount -t tmpfs tmpfs /tmp\necho \"Try: source /etc/goprofile && go run hello.go\"\n-- hello.go --\npackage main\n\nimport \"fmt\"\n\nfunc main() {\n    fmt.Println(\"Hello from Go in your browser!\")\n}\n"
    }
  },
  {
    "id": "python",
    "title": "Python playground",
    "language": "Python",
    "description": "A prebuilt Python overlay. No package downloads inside the VM.",
    "tags": [
      "Python"
    ],
    "document": {
      "src": "# apptron snapshot v1\noverlay: gallery/python\n-- .apptron/envrc --\ncd /project\npython3 hello.py\n-- hello.py --\nimport sys\n\nprint(\"Hello from Python in Apptron!\")\nprint(f\"Python {sys.version.split()[0]}\")\nfor n in range(1, 6):\n    print(\"*\" * n)\n"
    }
  },
  {
    "id": "c-make",
    "title": "C, meet Make",
    "language": "C",
    "description": "Compile a C program with the offline build tools overlay.",
    "tags": [
      "C"
    ],
    "document": {
      "src": "# apptron snapshot v1\noverlay: gallery/c\n-- .apptron/envrc --\ncd /project\necho \"Try: make && ./hello\"\n-- hello.c --\n#include <stdio.h>\n\nint main(void) {\n    puts(\"Hello from C in Apptron!\");\n    return 0;\n}\n-- Makefile --\nCC = cc\nCFLAGS = -Wall -Wextra -O2\nhello: hello.c\n\t$(CC) $(CFLAGS) -o $@ $<\nclean:\n\trm -f hello\n"
    }
  },
  {
    "id": "node",
    "title": "Node in a tab",
    "language": "JavaScript",
    "description": "Run JavaScript with Node and npm already installed.",
    "tags": [
      "JavaScript"
    ],
    "document": {
      "src": "# apptron snapshot v1\noverlay: gallery/node\n-- .apptron/envrc --\ncd /project\nnode hello.js\n-- hello.js --\nconsole.log('Hello from Node in Apptron!');\nconsole.log(`Node ${process.version}`);\nconsole.log([1, 2, 3, 4, 5].map(n => n * n).join(' · '));\n"
    }
  },
  {
    "id": "esbuild",
    "title": "Bundle something",
    "language": "JavaScript",
    "description": "Turn two JavaScript modules into one with the built-in esbuild.",
    "tags": [
      "JavaScript"
    ],
    "document": {
      "src": "# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\nesbuild main.js --bundle --outfile=bundle.js\necho \"Try: cat bundle.js\"\n-- main.js --\nimport { greeting } from './message.js';\nconsole.log(greeting('Apptron'));\n-- message.js --\nexport const greeting = name => `Hello, ${name}!`;\n"
    }
  },
  {
    "id": "wasm",
    "title": "Hello, WebAssembly",
    "language": "Wasm",
    "description": "Execute a small WASI binary natively through Apptron.",
    "tags": [
      "Wasm"
    ],
    "document": {
      "src": "# apptron snapshot v1\n-- .apptron/envrc --\ncd /project\nchmod +x hello.wasm\n./hello.wasm\n-- hello.wasm (base64) --\nAGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKDwENAEEBQQBBAUEIEAAaCwskAgBBAAsIEAAAABEAAAAAQRALEUhlbGxvIGZyb20gV2FzbSEK\n"
    }
  },
  {
    "id": "fun",
    "title": "Terminal diversions",
    "language": "Shell",
    "description": "Cowsay, figlet, and a train. A little room to play.",
    "tags": [
      "Shell"
    ],
    "document": {
      "src": "# apptron snapshot v1\noverlay: gallery/fun\n-- .apptron/envrc --\ncd /project\nexport PATH=\"$PATH:/usr/games\"\nfiglet Apptron\ncowsay \"Linux, in a browser tab.\"\necho \"Try: sl\"\n"
    }
  },
  {
    "id": "envbuild",
    "title": "Build your environment",
    "language": "Shell",
    "description": "Install a package with an envbuild script and your own network relay.",
    "needsRelay": true,
    "tags": [
      "Shell",
      "Needs relay"
    ],
    "document": {
      "src": "# apptron snapshot v1\n-- .apptron/envbuild --\n#!/bin/sh\nset -eu\napk add --no-cache jq\n-- .apptron/envrc --\ncd /project\njq . message.json\n-- message.json --\n{\"message\":\"Installed with envbuild and your network relay!\"}\n"
    }
  }
];
