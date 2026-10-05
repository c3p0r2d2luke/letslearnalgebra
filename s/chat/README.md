# Chat app

The Node TypeScript server renders the chat HTML shell for each page request,
injecting an explicit allowlist of browser-safe configuration from `.env`.
Browser scripts are TypeScript in `src/` and compile to JavaScript in `public/`;
the existing realtime UI, interactions, and styles remain browser-side.

## Configure and run

Create a private `chat/.env` from `.env.example`. It configures the local server
and stores the public identifiers/keys that the browser needs. The server
renders those allowlisted values into the HTML, so they remain visible to
visitors even though the `.env` file itself is not served. Never put Supabase
service-role keys, OAuth client secrets, bot tokens, or private signing keys in
this file; Supabase Edge Functions continue to own their server-side secrets.

```sh
# Run these commands from the s/ directory.
npm install
chmod 600 chat/.env
npm run build:chat
npm run check:chat-core
npm run check:chat-server
npm run start:chat
```

The server binds only to loopback and reads assets exclusively from `public/`.
Nginx proxies `/s/chat/` to it; `.env` and TypeScript source files are never
served. Rebuild after editing TypeScript, then restart `lla-chat`.
The build type-checks all browser TypeScript with `strict: false` while emitting
the legacy global scripts in their existing order. The core browser helpers
and Node server also have separate strict checks.

On the Nest host, Caddy terminates HTTPS and forwards the domain's port 80 to
Nginx. Nginx forwards only the chat path to the loopback Node server; leave TLS
termination at Caddy.
