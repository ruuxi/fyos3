## Getting Started

This guide walks through building a minimal WebContainers app with an editor and live preview, favoring pnpm commands.

### Prerequisites

- Modern Chromium- or Firefox-based browser (see browser support). [Browser support](https://webcontainers.io/guides/browser-support)
- Node.js locally is optional; the runtime runs in-browser.

### Project scaffold

Use the official tutorial as a reference for UI scaffolding. [Build your first WebContainer app](https://webcontainers.io/tutorial/1-build-your-first-webcontainer-app)

1) Add a left `textarea` and right `iframe`:

```html
<div class="container">
  <div class="editor">
    <textarea>I am a textarea</textarea>
  </div>
  <div class="preview">
    <iframe src="loading.html"></iframe>
  </div>
</div>
```

2) Show `loading.html` while the container initializes:

```html
Installing dependencies...
```

3) Style the layout (see tutorial for full CSS). [Tutorial](https://webcontainers.io/tutorial/1-build-your-first-webcontainer-app)

### Boot the WebContainer

```js
import { WebContainer } from '@webcontainer/api';

let webcontainer;

async function boot() {
  webcontainer = await WebContainer.boot({
    coep: 'require-corp',
    forwardPreviewErrors: 'exceptions-only',
  });
}
```

### Mount files

```js
await webcontainer.mount({
  'package.json': { file: { contents: '{"name":"demo","type":"module","scripts":{"dev":"vite"}}' } },
  'index.html': { file: { contents: '<div id="app"></div>' } },
  'src/main.js': { file: { contents: 'document.getElementById("app").textContent = "Hello"' } },
});
```

### Install and run (pnpm-first)

```js
const install = await webcontainer.spawn('pnpm', ['install']);
install.output.pipeTo(new WritableStream({ write: d => console.log(d) }));
await install.exit;

const dev = await webcontainer.spawn('pnpm', ['run', 'dev']);
webcontainer.on('server-ready', (port, url) => {
  document.querySelector('iframe').src = url;
});
```

For deeper details, see the guides: [Running processes](https://webcontainers.io/guides/running-processes), [Working with the file system](https://webcontainers.io/guides/working-with-the-file-system), and [API reference](https://webcontainers.io/api).


