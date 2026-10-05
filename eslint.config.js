// eslint.config.js
export default [
  {
    files: ["*.js"], // Apply to all JS files
    languageOptions: {
      ecmaVersion: 2026,
      sourceType: "module",
      globals: {
        // Browser globals
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        NodeFilter: "readonly",
        Notification: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        alert: "readonly",
        prompt: "readonly",
        confirm: "readonly",
        fetch: "readonly",
        Blob: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        location: "readonly",
        self: "readonly",
        emailjs: "readonly",
        console: "readonly"  // <-- added console
      }
    },
    rules: {
      "no-unused-vars": ["warn", {
        varsIgnorePattern: "data|unblockUser|sendReply|renderReply|insertResult|e"
      }],
      "no-undef": "error",
      "no-console": "off"
    }
  }
];