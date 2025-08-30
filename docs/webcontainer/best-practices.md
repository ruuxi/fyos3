## Best Practices

- Boot once, reuse: create a single `WebContainer` and reuse it to avoid costly reboots. [API](https://webcontainers.io/api)
- Stream output: pipe `process.output` to your UI for real-time feedback. [Running processes](https://webcontainers.io/guides/running-processes)
- Forward preview errors: set `forwardPreviewErrors` and handle `'preview-message'` to surface iframe errors. [API](https://webcontainers.io/api)
- Use snapshots/exports: persist sessions and restore quickly for shareable examples. [API](https://webcontainers.io/api)
- Configure COEP/COOP correctly across environments: dev, staging, prod. [Configuring headers](https://webcontainers.io/guides/configuring-headers)
- Prefer your package manager: npm/yarn/pnpm are supported; pnpm is fast and space-efficient. [Native PM support](https://blog.stackblitz.com/posts/announcing-native-package-manager-support/)


