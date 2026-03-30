export async function handler(event) {

  const TOKEN = "super-secret-token";

  const token = event.queryStringParameters.token;
  const url = event.queryStringParameters.url;

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

  const response = await fetch(proxyBase + url);

  const body = await response.text();

  return {
    statusCode: 200,
    headers: {
      "content-type": "text/html"
    },
    body
  };
}