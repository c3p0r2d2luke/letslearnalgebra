const messages = document.getElementById("messages");
const promptInput = document.getElementById("prompt");
const sendButton = document.getElementById("send");

let conversation = [];

// 1. Configure Marked to use Highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  breaks: true, // Converts \n to <br>
  gfm: true     // GitHub Flavored Markdown
});

function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  
  if (role === "ai") {
    // 2. Parse Markdown to HTML
    div.innerHTML = marked.parse(text);
    
    // 3. Re-run highlight on the newly created code blocks
    div.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  } else {
    // User messages stay plain text to prevent XSS
    div.textContent = text;
  }

  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function createThinkingIndicator() {
  const div = document.createElement("div");
  div.className = "message ai thinking-indicator";
  div.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
  div.id = "thinking-indicator";
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

async function sendMessage() {
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  addMessage(prompt, "user");
  conversation.push({ role: "user", content: prompt });
  promptInput.value = "";

  sendButton.disabled = true;
  sendButton.innerHTML = ''; // Clear icon
  createThinkingIndicator();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversation })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    const aiReply = data?.choices?.[0]?.message?.content || "No response.";

    const thinking = document.getElementById("thinking-indicator");
    if (thinking) thinking.remove();

    conversation.push({ role: "assistant", content: aiReply });
    addMessage(aiReply, "ai");

  } catch (error) {
    console.error(error);
    const thinking = document.getElementById("thinking-indicator");
    if (thinking) thinking.remove();
    addMessage("Error: Could not connect to server.", "ai");
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
  }
}

sendButton.addEventListener("click", sendMessage);
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});