// REMOVE node-fetch — Netlify already provides fetch globally
// import fetch from 'node-fetch';

export async function handler(event, context) {
  try {
    // Log the raw body
    console.log("RAW BODY:", event.body);

    if (!event.body) {
      return {
        statusCode: 400,
        body: "ERROR: event.body was empty or undefined"
      };
    }

    let data;
    try {
      data = JSON.parse(event.body);
    } catch (err) {
      return {
        statusCode: 400,
        body: "ERROR: JSON.parse failed:\n" + err.message + "\n\nBODY RECEIVED:\n" + event.body
      };
    }

    console.log("PARSED JSON:", data);

    const { pageURL } = data;

    if (!pageURL) {
      return {
        statusCode: 400,
        body: "ERROR: pageURL missing from JSON.\nJSON received:\n" + JSON.stringify(data, null, 2)
      };
    }

    console.log("FETCHING URL:", pageURL);

    let res;
    try {
      res = await fetch(pageURL);
    } catch (err) {
      return {
        statusCode: 500,
        body: "ERROR: fetch() failed:\n" + err.message + "\n\nURL:\n" + pageURL
      };
    }

    const htmlContent = await res.text();

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/html"
      },
      body: htmlContent
    };

  } catch (err) {
    return {
      statusCode: 500,
      body:
        "UNCAUGHT ERROR:\n" +
        err.message +
        "\n\nSTACK TRACE:\n" +
        err.stack
    };
  }
}
