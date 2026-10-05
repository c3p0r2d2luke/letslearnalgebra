interface SpotifyAuthCodeMessage {
  type: "spotify_auth_code";
  code: string;
  state: string | null;
  error?: string;
  status?: number;
  body?: string;
}

interface SpotifyAuthMessage {
  type: "spotify_auth";
  access_token: string | null;
  refresh_token?: string | null;
  expires_in?: string | null;
  token_type?: string | null;
}

interface SpotifyCallbackOpener extends Window {
  markSpotifyAsLinked?: () => void;
  refreshSettingsConnections?: () => void;
  updateAccountLinkButtons?: () => void;
}

const spotifyOpener = window.opener as SpotifyCallbackOpener | null;

function postSpotifyMessage(message: SpotifyAuthCodeMessage | SpotifyAuthMessage): void {
  spotifyOpener?.postMessage(message, window.location.origin);
}

async function handleSpotifyCallback(): Promise<void> {
  try {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (code) {
      try {
        const verifier = localStorage.getItem("spotify_pkce_verifier");
        const expectedState = localStorage.getItem("spotify_pkce_state");

        if (expectedState && state && expectedState !== state) {
          console.error("Spotify PKCE state mismatch");
        }

        if (!verifier) {
          console.error("No PKCE verifier found in localStorage");
          postSpotifyMessage({ type: "spotify_auth_code", code, state });
        } else {
          const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: localStorage.getItem("spotify_redirect_uri")
              || `${window.location.origin}${window.location.pathname}`,
            code_verifier: verifier,
          });
          const clientId = localStorage.getItem("spotify_client_id");
          if (clientId) body.set("client_id", clientId);

          try {
            const response = await fetch("https://accounts.spotify.com/api/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: body.toString(),
            });

            if (!response.ok) {
              const responseBody = await response.text();
              console.error("Token exchange failed", response.status, responseBody);
              postSpotifyMessage({
                type: "spotify_auth_code",
                code,
                state,
                error: "token_exchange_failed",
                status: response.status,
                body: responseBody,
              });
            } else {
              const token = await response.json();
              postSpotifyMessage({
                type: "spotify_auth",
                access_token: token.access_token ?? null,
                refresh_token: token.refresh_token ?? null,
                expires_in: token.expires_in == null ? null : String(token.expires_in),
              });
            }
          } catch (error) {
            console.error("Token exchange error", error);
            postSpotifyMessage({ type: "spotify_auth_code", code, state, error: "token_exchange_exception" });
          }
        }
      } catch (error) {
        console.error("PKCE exchange error", error);
        postSpotifyMessage({ type: "spotify_auth_code", code, state, error: "pkce_error" });
      }
    } else {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get("access_token");
      if (accessToken) {
        postSpotifyMessage({
          type: "spotify_auth",
          access_token: accessToken,
          token_type: hashParams.get("token_type"),
          expires_in: hashParams.get("expires_in"),
        });
      }
    }
  } catch (error) {
    console.error("Callback handler error", error);
  }

  try {
    spotifyOpener?.markSpotifyAsLinked?.();
    spotifyOpener?.refreshSettingsConnections?.();
    spotifyOpener?.updateAccountLinkButtons?.();
  } catch (error) {
    console.warn("Could not notify the Spotify popup opener:", error);
  }

  setTimeout(() => window.close(), 700);
}

void handleSpotifyCallback();
