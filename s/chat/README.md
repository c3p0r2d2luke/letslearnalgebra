# Chat app

The Node TypeScript server serves the chat HTML shell and a generated,
explicitly allowlisted browser configuration script from `.env`.
Browser scripts are TypeScript in `src/` and compile to JavaScript in `public/`;
the existing realtime UI, interactions, and styles remain browser-side.

## Configure and run

Create a private `chat/.env` from `.env.example`. It configures the local server
and stores the public identifiers/keys that the browser needs. The server
serves those allowlisted values as a generated configuration script, so they
remain visible to visitors even though the `.env` file itself is not served.
Never put Supabase service-role keys, OAuth client secrets, bot tokens, or
private signing keys in this file; Supabase Edge Functions continue to own
their server-side secrets.

```sh
# Run these commands from the s/ directory.
npm ci
chmod 600 chat/.env
npm run check:chat-core
npm run check:chat-server
npm run start:chat
```

`start:chat` compiles the browser and server TypeScript before starting the
server, so the generated browser JavaScript is always present after a deploy.
The server reads assets exclusively from `public/`; `.env` and TypeScript
sources are never served.

For a Nest deployment, set the site's upstream port to `PORT` (default `3501`)
and keep Caddy's automatic HTTPS termination enabled. The Node server speaks
plain HTTP behind Caddy and defaults to `HOST=0.0.0.0`, which allows a proxy in
a separate container/network namespace to reach it. If Caddy runs on the same
host, `HOST=127.0.0.1` is also suitable. Do not configure TLS in this app.
Keep the upstream port private; expose the site through Nest's HTTPS proxy.

The default `CHAT_BASE_PATH=/s/chat` supports both reverse-proxy styles: Caddy
or a fronting web server may preserve `/s/chat/` when forwarding, or strip that
prefix. The shell and its relative assets continue to work either way. Point
the HTTPS callback URLs in Discord, Spotify, and Supabase at the public
`https://<your-domain>/s/chat/...` paths, not the internal HTTP upstream.

Browser files under `src/` are TypeScript; the `.js` files in `public/` are
generated build output. The build also compiles the Node server to
`dist/server.js`. Browser scripts remain classic scripts in their existing
load order to preserve the current global-based application.

After updating the IP logging Edge Function, deploy it to the linked Supabase
project with `supabase functions deploy log-ip`; Caddy only handles the chat
site's incoming HTTPS traffic and cannot apply changes to Supabase endpoints.
