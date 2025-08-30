## File System

WebContainers provide an in-memory virtual file system (VFS). You can mount an entire tree at once or write files incrementally, then run processes that operate on those files. [Working with the file system](https://webcontainers.io/guides/working-with-the-file-system), [API reference](https://webcontainers.io/api)

### Mounting a tree

```js
await wc.mount({
  'package.json': { file: { contents: '{"name":"demo","type":"module"}' } },
  src: {
    directory: {
      'main.js': { file: { contents: 'console.log("Hello")' } }
    }
  }
});
```

### Reading and writing

```js
await wc.fs.writeFile('/README.md', '# Hello');
const text = await wc.fs.readFile('/README.md', 'utf-8');
await wc.fs.mkdir('/src');
const list = await wc.fs.readdir('/');
```

### Export/import projects

Export the VFS, persist to storage, and re-import later for fast restores or sharing. [API reference](https://webcontainers.io/api)

```js
const blob = await wc.export({ format: 'zip', excludes: ['node_modules/**'] });
// Save blob to IndexedDB or download client-side
```

To restore, mount the snapshot back into a new instance using `mount` (see the API docs for supported formats).


