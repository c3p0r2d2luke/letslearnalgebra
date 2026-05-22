const messages = document.getElementById("messages");
const promptInput = document.getElementById("prompt");
const sendButton = document.getElementById("send");

let conversation = [];

// Configure marked.js for markdown rendering
marked.setOptions({
  highlight: function(code, lang) {
    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
    return hljs.highlight(code, { language }).value;
  },
  breaks: true,
  gfm: true
});

function addMessage(text, role) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  
  // Render markdown for AI messages, plain text for user
  if (role === "ai") {
    div.innerHTML = marked.parse(text);
    // Apply syntax highlighting to any code blocks
    div.querySelectorAll('pre code').forEach((block) => {
      hljs.highlightElement(block);
    });
  } else {
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

  // Add user message to UI
  addMessage(prompt, "user");

  // Save to conversation history
  conversation.push({
    role: "user",
    content: prompt
  });

  // Clear input
  promptInput.value = "";

  // Disable button while loading
  sendButton.disabled = true;
  sendButton.textContent = "";
  
  // Show thinking indicator
  createThinkingIndicator();

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messages: conversation
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    const aiReply = data?.choices?.[0]?.message?.content || "No response from AI.";

    // Remove thinking indicator
    const thinkingIndicator = document.getElementById("thinking-indicator");
    if (thinkingIndicator) {
      thinkingIndicator.remove();
    }

    // Add AI message to conversation history
    conversation.push({
      role: "assistant",
      content: aiReply
    });

    // Show AI message with markdown rendered
    addMessage(aiReply, "ai");

  } catch (error) {
    console.error(error);
    
    // Remove thinking indicator
    const thinkingIndicator = document.getElementById("thinking-indicator");
    if (thinkingIndicator) {
      thinkingIndicator.remove();
    }
    
    addMessage("Error communicating with AI server.", "ai");
  } finally {
    sendButton.disabled = false;
    sendButton.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
      </svg>
    `;
  }
}

sendButton.addEventListener("click", sendMessage);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});