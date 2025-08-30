## API Reference

Complete reference for the WebContainer API. The main entry point is the `WebContainer` class. [API reference](https://webcontainers.io/api)

---

## `WebContainer`

The main export representing a runtime ready to be used. An instance represents an in-browser Node.js runtime.

### Properties

#### `fs: FileSystemAPI`
Access to the underlying virtual file system. [API reference](https://webcontainers.io/api)

#### `path: string`
Default value of the `PATH` environment variable for processes started through spawn. [API reference](https://webcontainers.io/api)

#### `workdir: string`
Full path to the working directory. [API reference](https://webcontainers.io/api)

### Methods

#### `WebContainer.boot(options?: BootOptions): Promise<WebContainer>`

Boots a WebContainer. Only a single instance can be booted concurrently. Booting is expensive - reuse when possible. [API reference](https://webcontainers.io/api)

```ts
interface BootOptions {
  coep?: 'require-corp' | 'credentialless' | 'none';
  workdirName?: string;
  forwardPreviewErrors?: boolean | 'exceptions-only';
}
```

**BootOptions properties:**

- **`coep`**: COEP header value for your application. `'none'` only works on Chromium with Origin Trial support. This value is fixed on first boot.
- **`workdirName`**: Folder name for working directory (cosmetic option).
- **`forwardPreviewErrors`**: Whether to forward preview iframe errors to parent page. Set to `'exceptions-only'` to exclude `console.error` calls.

```js
const wc = await WebContainer.boot({
  coep: 'require-corp',
  forwardPreviewErrors: 'exceptions-only'
});
```

#### `mount(tree: FileSystemTree | Uint8Array | ArrayBuffer, options?: MountOptions): Promise<void>`

Mounts a tree of files into the filesystem. Can be a FileSystemTree object or binary snapshot. [API reference](https://webcontainers.io/api)

```ts
interface MountOptions {
  mountPoint?: string;
}
```

```js
await wc.mount({
  'package.json': { file: { contents: '{"name":"demo"}' } },
  src: {
    directory: {
      'main.js': { file: { contents: 'console.log("Hello")' } }
    }
  }
});
```

#### `spawn(command: string, args?: string[], options?: SpawnOptions): Promise<WebContainerProcess>`

Spawns a process. [Running processes](https://webcontainers.io/guides/running-processes), [API reference](https://webcontainers.io/api)

```ts
interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | number | boolean>;
  output?: boolean;
  terminal?: { cols: number; rows: number };
}
```

**SpawnOptions properties:**

- **`cwd`**: Current working directory relative to workdir
- **`env`**: Environment variables for the process
- **`output`**: When false, no terminal output is sent back (default: true)
- **`terminal`**: Size of attached terminal

```js
// With args
const install = await wc.spawn('npm', ['install']);

// Without args
const yarn = await wc.spawn('yarn');

// With options
const build = await wc.spawn('npm', ['run', 'build'], {
  cwd: '/project',
  env: { NODE_ENV: 'production' }
});
```

#### `on(event, listener): () => void`

Listens for events. Returns unsubscribe function. [API reference](https://webcontainers.io/api)

**Event types:**

##### `'port'` events
Emitted when a port is opened or closed.

```ts
wc.on('port', (port: number, type: 'open' | 'close', url: string) => {
  console.log(`Port ${port} ${type} at ${url}`);
});
```

##### `'error'` events
Emitted on internal errors.

```ts
wc.on('error', (error: { message: string }) => {
  console.error('WebContainer error:', error.message);
});
```

##### `'server-ready'` events
Emitted when a server is ready to receive traffic.

```ts
wc.on('server-ready', (port: number, url: string) => {
  document.querySelector('iframe').src = url;
});
```

##### `'preview-message'` events
Emitted when preview iframe forwards errors (requires `forwardPreviewErrors`).

```ts
wc.on('preview-message', (message: PreviewMessage) => {
  console.log('Preview error:', message);
});
```

**PreviewMessage types:**

```ts
type PreviewMessage = (UncaughtExceptionMessage | UnhandledRejectionMessage | ConsoleErrorMessage) & BasePreviewMessage;

interface BasePreviewMessage {
  previewId: string;
  port: number;
  pathname: string;
  search: string;
  hash: string;
}

interface UncaughtExceptionMessage {
  type: 'UncaughtException';
  message: string;
  stack: string | undefined;
}

interface UnhandledRejectionMessage {
  type: 'UnhandledRejection';
  message: string;
  stack: string | undefined;
}

interface ConsoleErrorMessage {
  type: 'ConsoleError';
  args: any[];
  stack: string;
}
```

#### `export(options?: ExportOptions): Promise<Uint8Array>`

Exports the file system for persistence or sharing. [API reference](https://webcontainers.io/api)

```ts
interface ExportOptions {
  format?: 'json' | 'binary' | 'zip';
  includes?: string[];
  excludes?: string[];
}
```

**ExportOptions properties:**

- **`format`**: Export format. `json` and `binary` can be used with `mount()`. Default: `'json'`
- **`includes`**: Globbing patterns to include files from excluded folders
- **`excludes`**: Globbing patterns to exclude files

```js
const snapshot = await wc.export({
  format: 'zip',
  excludes: ['node_modules/**', '.git/**']
});
```

#### `teardown(): Promise<void>`

Tears down the WebContainer instance. Required before booting a new instance. [API reference](https://webcontainers.io/api)

#### `injectPreviewScript(src: string, options?: PreviewScriptOptions): void`

Injects a script into preview pages. [API reference](https://webcontainers.io/api)

```ts
interface PreviewScriptOptions {
  type?: 'module' | 'importmap';
  defer?: boolean;
  async?: boolean;
}
```

---

## `FileSystemAPI`

Virtual file system operations. [API reference](https://webcontainers.io/api)

### Methods

#### Basic file operations

```js
// Write file
await wc.fs.writeFile('/path/to/file.txt', 'content', 'utf-8');

// Read file
const content = await wc.fs.readFile('/path/to/file.txt', 'utf-8');

// Check if file exists
const exists = await wc.fs.exists('/path/to/file.txt');

// Remove file
await wc.fs.rm('/path/to/file.txt');
```

#### Directory operations

```js
// Create directory
await wc.fs.mkdir('/path/to/dir', { recursive: true });

// Read directory
const entries = await wc.fs.readdir('/path/to/dir', { withFileTypes: true });

// Remove directory
await wc.fs.rm('/path/to/dir', { recursive: true });
```

#### File watching

```js
// Watch file
const watcher = wc.fs.watch('/src/main.js', (event) => {
  console.log(`File ${event}`);
});

// Watch directory recursively
const dirWatcher = wc.fs.watch('/src', { recursive: true }, (event, filename) => {
  console.log(`${filename}: ${event}`);
});

// Stop watching
watcher.close();
```

**Watch options:**

```ts
interface WatchOptions {
  encoding?: BufferEncoding | null; // default: 'utf8'
  recursive?: boolean;              // default: false
}

type WatchListener = (event: 'rename' | 'change', filename: string | Buffer) => void;

interface Watcher {
  close(): void;
}
```

---

## `WebContainerProcess`

A running process spawned in WebContainer. [API reference](https://webcontainers.io/api)

### Properties

#### `exit: Promise<number>`
Promise for the exit code of the process.

#### `input: WritableStream<string>`
Input stream for the attached pseudoterminal device.

#### `output: ReadableStream<string>`
Stream receiving all terminal output (stdout and stderr). Can be disabled with `spawn(..., { output: false })`.

### Methods

#### `kill(): void`
Kills the process.

#### `resize(dimensions: { cols: number; rows: number }): void`
Resizes the attached terminal.

### Usage example

```js
const proc = await wc.spawn('node', ['script.js'], {
  terminal: { cols: 80, rows: 24 }
});

// Handle output
proc.output.pipeTo(new WritableStream({
  write(chunk) {
    console.log(chunk);
  }
}));

// Send input
const writer = proc.input.getWriter();
await writer.write('input line\n');
writer.releaseLock();

// Resize terminal
proc.resize({ cols: 100, rows: 30 });

// Wait for exit
const exitCode = await proc.exit;

// Or kill early
proc.kill();
```

---

## File System Types

### `FileSystemTree`

Tree-like structure describing folder contents for mounting. [API reference](https://webcontainers.io/api)

```ts
interface FileSystemTree {
  [name: string]: FileNode | SymlinkNode | DirectoryNode;
}
```

#### `FileNode`
```ts
interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}
```

#### `SymlinkNode`
```ts
interface SymlinkNode {
  file: {
    symlink: string;
  };
}
```

#### `DirectoryNode`
```ts
interface DirectoryNode {
  directory: FileSystemTree;
}
```

### Example FileSystemTree

```js
const tree = {
  myproject: {
    directory: {
      'package.json': {
        file: {
          contents: '{"name": "demo", "type": "module"}'
        }
      },
      'src': {
        directory: {
          'main.js': {
            file: {
              contents: 'console.log("Hello World");'
            }
          },
          'config.js': {
            file: {
              symlink: '../config/default.js'
            }
          }
        }
      },
      '.envrc': {
        file: {
          contents: 'ENVIRONMENT=development'
        }
      }
    }
  },
  emptyFolder: {
    directory: {}
  }
};
```

---

## Utility Types

### `BufferEncoding`

```ts
type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex';
```

Used for file encoding in filesystem operations and watch listeners. [API reference](https://webcontainers.io/api)


