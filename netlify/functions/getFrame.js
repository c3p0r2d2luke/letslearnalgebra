const crypto = require("crypto");

const HASHED =
  "387fa2846d81a73efacd99f920cd6fd89e9f24e579cf84eada912728bd62ad66";

exports.handler = async function (event, context) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { password } = JSON.parse(event.body || "{}");
    const hash = crypto.createHash("sha256").update(password).digest("hex");

    if (hash !== HASHED) {
      return { statusCode: 403, body: JSON.stringify({ error: "nope" }) };
    }

    const secretURL = process.env.SECRET_IFRAME_URL;

    return {
      statusCode: 200,
      body: JSON.stringify({ url: secretURL }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: "server error" }) };
  }
};
