## Headers and Hosting

WebContainers require cross-origin isolation for key capabilities. Configure these headers on your host: [Configuring headers](https://webcontainers.io/guides/configuring-headers)

```
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### Platform examples

Netlify (`netlify.toml`):

```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Opener-Policy = "same-origin"
```

Vercel (`vercel.json`):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

Cloudflare/static hosts: use `_headers` or equivalent to set global headers.

### Browser support notes

Consult the support matrix and any Chromium origin trial requirements (e.g., `coep: 'none'`). Prefer `require-corp` or `credentialless`. [Browser support](https://webcontainers.io/guides/browser-support), [API](https://webcontainers.io/api)


