## Troubleshooting

- Blank preview or `SharedArrayBuffer` errors: confirm COEP/COOP headers and avoid cross-origin assets that break isolation. [Configuring headers](https://webcontainers.io/guides/configuring-headers)
- Multiple boots error: only one container at a time; tear down before re-booting. [API](https://webcontainers.io/api)
- No process output: ensure `output` is enabled (default) and pipe `process.output` to a stream. [Running processes](https://webcontainers.io/guides/running-processes)
- File changes not reflected: make sure writes land in the mounted path; restart dev server if needed. [Working with the file system](https://webcontainers.io/guides/working-with-the-file-system)
- Chromium COEP 'none': may require origin trial; prefer `require-corp` or `credentialless`. [API](https://webcontainers.io/api)


