## Running Processes

Use `spawn` to execute commands (package managers, dev servers, tests) inside the container. [Running processes](https://webcontainers.io/guides/running-processes), [API reference](https://webcontainers.io/api)

### Installing dependencies (pnpm)

```js
const install = await wc.spawn('pnpm', ['install']);
install.output.pipeTo(new WritableStream({ write: d => console.log(d) }));
const code = await install.exit; // 0 on success
```

### Running a dev server and previewing

```js
const dev = await wc.spawn('pnpm', ['run', 'dev']);
wc.on('server-ready', (port, url) => {
  document.querySelector('iframe').src = url;
});
```

### Process IO and control

```js
const proc = await wc.spawn('node', ['script.js'], { terminal: { cols: 80, rows: 24 } });
proc.output.pipeTo(new WritableStream({ write: d => console.log(d) }));
const writer = proc.input.getWriter();
await writer.write('input line\n');
writer.releaseLock();
proc.resize({ cols: 100, rows: 30 });
proc.kill();
```

### Environment and working directory

```js
await wc.spawn('pnpm', ['run', 'build'], { cwd: '/project', env: { NODE_ENV: 'production' } });
```


