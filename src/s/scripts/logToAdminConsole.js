import { adminDebugPanel, escapeHTML } from "./script";

export function logToAdminConsole(message, type = 'log') {
  if (!adminDebugPanel) return;

  const output = document.getElementById('admin-console-output');
  const line = document.createElement('div');
  line.style.cssText = `
    margin-bottom: 4px;
    word-wrap: break-word;
    border-left: 3px solid transparent;
    padding-left: 8px;
  `;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = `[${timestamp}]`;

  switch (type) {
    case 'error':
      line.style.borderLeftColor = '#ed4245';
      line.style.color = '#ff6b6b';
      break;
    case 'warn':
      line.style.borderLeftColor = '#faa61a';
      line.style.color = '#ffd966';
      break;
    case 'success':
      line.style.borderLeftColor = '#3ba55d';
      line.style.color = '#3ba55d';
      break;
    case 'info':
      line.style.borderLeftColor = '#5865f2';
      line.style.color = '#5865f2';
      break;
    default:
      line.style.borderLeftColor = '#949ba4';
      line.style.color = '#dbdee1';
  }

  line.innerHTML = `<span style="opacity: 0.6; margin-right: 8px;">${prefix}</span>${escapeHTML(message)}`;
  output.appendChild(line);
  output.scrollTop = output.scrollHeight;
}
