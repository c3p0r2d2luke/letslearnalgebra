export async function handler(event) {

  const TOKEN = "super-secret-token";

  const token = event.queryStringParameters.token;
  const url = decodeURIComponent(event.queryStringParameters.url || "");

  if (token !== TOKEN) {
    return {
      statusCode: 403,
      body: "Forbidden"
    };
  }

  if (!url) {
    return {
      statusCode: 400,
      body: "Missing URL"
    };
  }

  const proxyBase = "https://fastermath.neo-space.space/scramjet/";

  return {
    statusCode: 302,
    headers: {
      Location: proxyBase + url
    }
  };
}