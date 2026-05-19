const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.static('public')); // Serve your frontend HTML here

// Helper to rewrite URLs
function rewriteUrl(url, baseUrl, proxyPath) {
  if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('#')) return url;
  try {
    const absolute = new URL(url, baseUrl).href;
    // Prefix with our proxy path so Nginx routes it back here
    return `/proxy/${proxyPath}/${absolute}`;
  } catch (e) {
    return url;
  }
}

// Main Proxy Endpoint
app.get('/proxy/:path*', async (req, res) => {
  const targetUrl = decodeURIComponent(req.params.path);
  
  try {
    // Fetch the target
    const response = await axios.get(targetUrl, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    let html = response.data;
    const $ = cheerio.load(html, { decodeEntities: false });

    // 1. STRIP CSP HEADERS (Cheerio can't touch HTTP headers, so we strip meta tags)
    $('meta[http-equiv="Content-Security-Policy"]').remove();
    $('meta[name="csp-nonce"]').remove();

    // 2. REWRITE ASSETS
    const baseUrl = new URL(targetUrl);
    
    // Rewrite Links (CSS, JS, Images)
    $('link[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) $(el).attr('href', rewriteUrl(href, targetUrl, 'static'));
    });

    $('script[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src) $(el).attr('src', rewriteUrl(src, targetUrl, 'static'));
    });

    $('img[src], source[src], source[srcset]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('srcset');
      if (src) {
        // Handle srcset (comma separated)
        if ($(el).attr('srcset')) {
           const newSrcset = src.split(',').map(part => {
             const [url, size] = part.trim().split(/\s+/);
             return `${rewriteUrl(url, targetUrl, 'static')} ${size || ''}`;
           }).join(', ');
           $(el).attr('srcset', newSrcset);
        } else {
           $(el).attr('src', rewriteUrl(src, targetUrl, 'static'));
        }
      }
    });

    // Rewrite CSS url() inside style attributes and style blocks
    $('style').each((_, el) => {
      let css = $(el).html();
      css = css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
        if (url.startsWith('data:')) return match;
        return `url('${rewriteUrl(url, targetUrl, 'static')}')`;
      });
      $(el).html(css);
    });

    $('*[style]').each((_, el) => {
      const style = $(el).attr('style');
      if (style) {
        const newStyle = style.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
          if (url.startsWith('data:')) return match;
          return `url('${rewriteUrl(url, targetUrl, 'static')}')`;
        });
        $(el).attr('style', newStyle);
      }
    });

    // 3. ADD BASE TAG
    $('head').prepend(`<base href="${targetUrl}">`);

    // Return the modified HTML
    res.set('Content-Type', 'text/html');
    res.send($.html());

  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error fetching ${targetUrl}: ${error.message}`);
  }
});

// WebSocket Proxy (Crucial for Discord)
const http = require('http');
const server = http.createServer(app);
const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ server, path: '/proxy/ws/*' });

wss.on('connection', (ws, req) => {
  const targetUrl = `wss://${req.url.replace('/proxy/ws/', '')}`;
  console.log(`WS Connecting to: ${targetUrl}`);

  const targetWs = new WebSocket(targetUrl);

  targetWs.on('open', () => {
    ws.send(JSON.stringify({ type: 'connected' })); // Optional handshake
  });

  targetWs.on('message', (data) => {
    if (ws.readyState === 1) ws.send(data);
  });

  ws.on('message', (data) => {
    if (targetWs.readyState === 1) targetWs.send(data);
  });

  ws.on('close', () => targetWs.close());
  targetWs.on('close', () => ws.close());
  
  targetWs.on('error', (err) => {
    console.error('Target WS Error:', err);
    ws.close();
  });
});

server.listen(PORT, () => {
  console.log(`Lumo Proxy running on port ${PORT}`);
});
