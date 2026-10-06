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

## Chat commands

The only implemented slash command is:

| Command | Description | Notes |
|---|---|---|
| `/gif <search>` | Search for a GIF and choose one to send, for example `/gif cats`. | Requires the server's **Send GIFs** permission (or a legacy Manager/Admin role). In the picker, choose a result to send it; press Enter to send the first result or Escape to close. |

Type `/` in the message box to see command suggestions. `/help`, `/ping`,
`/echo`, `/me`, and `/clear` are not currently implemented.

## Build, check, and deploy commands

Run these from `s/`:

```sh
# Compile browser assets and the Node server
npm run build:chat

# Run the chat-specific TypeScript checks
npm run check:chat-core
npm run check:chat-server

# Build, then run the chat server in the foreground (uses chat/.env)
npm run start:chat

# After building changed code, restart the installed systemd service
sudo systemctl restart lla-chat.service
sudo systemctl status lla-chat.service --no-pager

# Inspect recent service logs
sudo journalctl -u lla-chat.service -n 100 --no-pager
```

For a source deployment, update the checkout first, then build and restart:

```sh
git pull
npm run build:chat
sudo systemctl restart lla-chat.service
```

Check the service's actual checkout and systemd configuration before using
these deployment commands on another host; service names and paths can differ.
To verify the runtime browser configuration is being served, request
`https://<your-domain>/s/chat/chat-config.js`. This script intentionally
contains public client configuration; do not put server-side secrets in it.

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

Channel and direct-message history initially loads the newest 100 messages.
Scroll to the top of the message list to automatically prepend the next 100
older messages while preserving your place in the conversation. Loaded
messages remain available as you continue scrolling; there are no history
navigation buttons. Discord history polling is limited to the currently open
channel.

After updating the IP logging Edge Function, deploy it to the linked Supabase
project with `supabase functions deploy log-ip`; Caddy only handles the chat
site's incoming HTTPS traffic and cannot apply changes to Supabase endpoints.
