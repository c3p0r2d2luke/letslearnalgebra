const messages = document.getElementById("messages");
const promptInput = document.getElementById("prompt");
const sendButton = document.getElementById("send");

let conversation = [];

function addMessage(text, role) {
  const div = document.createElement("div");

  div.className = `message ${role}`;
  div.textContent = text;

  messages.appendChild(div);

  messages.scrollTop = messages.scrollHeight;
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
  sendButton.textContent = "Thinking...";

  try {
    // Send to YOUR backend
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

    console.log(data);

    const aiReply =
      data?.choices?.[0]?.message?.content ||
      "No response from AI.";

    // Add AI message to conversation history
    conversation.push({
      role: "assistant",
      content: aiReply
    });

    // Show AI message
    addMessage(aiReply, "ai");

  } catch (error) {
    console.error(error);

    addMessage(
      "Error communicating with AI server.",
      "ai"
    );
  } finally {
    sendButton.disabled = false;
    sendButton.textContent = "Send";
  }
}

sendButton.addEventListener("click", sendMessage);

promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendMessage();
  }
});
