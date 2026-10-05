import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = dirname(fileURLToPath(import.meta.url));
const publicDirectory = resolve(
  serverDirectory,
  serverDirectory.endsWith(`${sep}dist`) ? "../public" : "public",
);
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3501);
const configuredBasePath = process.env.CHAT_BASE_PATH?.trim() || "/s/chat";

function normalizeBasePath(value: string): string {
  if (!value.startsWith("/") || value.includes("?") || value.includes("#") || value.includes("\\")) {
    throw new Error("CHAT_BASE_PATH must be an absolute URL path without query or fragment.");
  }

  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("CHAT_BASE_PATH cannot contain dot segments.");
  }
  return segments.length ? `/${segments.join("/")}` : "";
}

const chatBasePath = normalizeBasePath(configuredBasePath);

function requiredEnvironmentValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required chat configuration: ${name}`);
  return value;
}

const publicConfig = {
  SUPABASE_URL: requiredEnvironmentValue("SUPABASE_URL"),
  SUPABASE_PUBLISHABLE_KEY: requiredEnvironmentValue("SUPABASE_PUBLISHABLE_KEY"),
  SPOTIFY_CLIENT_ID: requiredEnvironmentValue("SPOTIFY_CLIENT_ID"),
  DISCORD_CLIENT_ID: requiredEnvironmentValue("DISCORD_CLIENT_ID"),
  DISCORD_REDIRECT_URI: requiredEnvironmentValue("DISCORD_REDIRECT_URI"),
  VAPID_PUBLIC_KEY: requiredEnvironmentValue("VAPID_PUBLIC_KEY"),
};
const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

if (isIP(host) === 0) {
  throw new Error("HOST must be an IP address.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
const chatShellPath = resolve(publicDirectory, "index.html");

const server = createServer(async (request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }

  let pathname: string;
  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url || "/", "http://localhost");
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.split("/").some((part) => part.startsWith("."))) {
    response.writeHead(404).end("Not found");
    return;
  }

  const legacyShellPath = chatBasePath ? `${chatBasePath}.html` : "/chat.html";
  if (pathname === legacyShellPath) {
    response.writeHead(302, {
      Location: `${chatBasePath}/index.html${requestUrl.search}`,
      "Cache-Control": "no-store",
    }).end();
    return;
  }

  if (chatBasePath && pathname === chatBasePath) {
    response.writeHead(302, {
      Location: `${chatBasePath}/${requestUrl.search}`,
      "Cache-Control": "no-store",
    }).end();
    return;
  }

  if (chatBasePath && pathname.startsWith(`${chatBasePath}/`)) {
    pathname = pathname.slice(chatBasePath.length) || "/";
  }

  if (pathname === "/chat-config.js") {
    const publicConfigJson = JSON.stringify(publicConfig).replace(/</g, "\\u003c");
    const configScript = `window.CHAT_CONFIG = Object.freeze(${publicConfigJson});\n`;
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Length": Buffer.byteLength(configScript),
      "Cache-Control": "no-store",
    });
    response.end(request.method === "HEAD" ? undefined : configScript);
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    try {
      const shell = await readFile(chatShellPath, "utf8");
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(shell),
        "Cache-Control": "no-store",
      });
      response.end(request.method === "HEAD" ? undefined : shell);
    } catch (error) {
      console.error("Chat shell render failed:", error);
      response.writeHead(500).end("Chat is temporarily unavailable");
    }
    return;
  }

  let filePath = resolve(publicDirectory, `.${pathname}`);
  if (filePath !== publicDirectory && !filePath.startsWith(`${publicDirectory}${sep}`)) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = resolve(filePath, "index.html");
      fileStat = await stat(filePath);
    }
    if (!fileStat.isFile()) throw new Error("Not a file");

    const extension = extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[extension] || "application/octet-stream",
      "Content-Length": fileStat.size,
      "Cache-Control": filePath.endsWith(".html") || filePath.endsWith("/sw.js")
        ? "no-cache, no-store, must-revalidate"
        : "public, max-age=300",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath).pipe(response);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      response.writeHead(404).end("Not found");
      return;
    }
    console.error("Chat asset request failed:", error);
    response.writeHead(500).end("Internal server error");
  }
});

server.listen(port, host, () => {
  console.info(`Chat static server listening on ${host}:${port}`);
});
