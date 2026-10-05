type DialogResult = string | boolean | null;

interface DialogOptions {
  title?: string;
  message?: string;
  input?: boolean;
  confirm?: string;
  danger?: boolean;
  initialValue?: string;
}

interface ActiveDialog {
  overlay: HTMLDivElement;
  resolve(value: DialogResult): void;
}

(function () {
  let activeDialog: ActiveDialog | null = null;

  function closeDialog(value: DialogResult): void {
    if (!activeDialog) return;
    const { overlay, resolve } = activeDialog;
    activeDialog = null;
    overlay.remove();
    resolve(value);
  }

  function showDialog({ title, message, input, confirm, danger, initialValue = "" }: DialogOptions): Promise<DialogResult> {
    if (activeDialog) closeDialog(null);
    const overlay = document.createElement("div");
    overlay.className = "app-dialog-overlay";
    overlay.innerHTML = `
      <div class="app-dialog" role="dialog" aria-modal="true">
        <div class="app-dialog-title">${escapeDialogText(title || "LLA")}</div>
        <div class="app-dialog-message">${escapeDialogText(message || "").replace(/\n/g, "<br>")}</div>
        ${input ? `<input class="app-dialog-input" type="text" value="${escapeDialogText(initialValue)}">` : ""}
        <div class="app-dialog-actions">
          <button class="app-dialog-cancel" type="button">Cancel</button>
          <button class="app-dialog-confirm ${danger ? "danger" : ""}" type="button">${confirm || "OK"}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const inputEl = overlay.querySelector<HTMLInputElement>(".app-dialog-input");
    const confirmBtn = overlay.querySelector<HTMLButtonElement>(".app-dialog-confirm")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>(".app-dialog-cancel")!;
    const promise = new Promise<DialogResult>((resolve) => {
      activeDialog = { overlay, resolve };
      cancelBtn.onclick = () => closeDialog(null);
      confirmBtn.onclick = () => closeDialog(input && inputEl ? inputEl.value : true);
      overlay.onclick = (event: MouseEvent) => {
        if (event.target === overlay) closeDialog(null);
      };
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
        inputEl.onkeydown = (event: KeyboardEvent) => {
          if (event.key === "Enter") confirmBtn.click();
          if (event.key === "Escape") cancelBtn.click();
        };
      } else {
        confirmBtn.focus();
      }
    });
    return promise;
  }

  function escapeDialogText(value: string): string {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  window.guiAlert = (message: string, title = "Notice") =>
    showDialog({ title, message, confirm: "OK" });
  window.guiConfirm = (message: string, title = "Confirm", danger = false) =>
    showDialog({ title, message, confirm: "Confirm", danger });
  window.guiPrompt = (message: string, initialValue = "", title = "Input") =>
    showDialog({ title, message, input: true, initialValue, confirm: "Save" });

  // Alerts do not require a return value, so existing notification paths can
  // use the in-app dialog without blocking the browser thread.
  window.alert = (message) => {
    void window.guiAlert(message);
  };
})();
