
// ─────────────────────────────────────────────────────────────────────────────
// 4.  TUTORIAL SYSTEM
//     Call  startTutorial()  after a brand-new user's first login.
//     Highlights key UI areas one by one with a pulsing spotlight.
//     Progress is saved in localStorage so it only shows once.
// ─────────────────────────────────────────────────────────────────────────────
const TUTORIAL_KEY = "lla_tutorial_done_v2";

const TUTORIAL_STEPS = [
  {
    selector: ".server-sidebar",
    title: "Your Servers",
    body: "Each icon here is a server — like a classroom or club. Click one to open it.",
    position: "right",
  },
  {
    selector: ".channel-sidebar",
    title: "Channels",
    body: "Channels are like rooms inside a server. Text channels let you chat; voice channels let you talk live.",
    position: "right",
  },
  {
    selector: "#dmList",
    title: "Direct Messages",
    body: "Send a private message to any member by hitting the <b>+</b> next to Direct Messages.",
    position: "right",
  },
  {
    selector: "#messageInput",
    title: "Send a Message",
    body: "Type here and press <b>Enter</b> (or the Send button) to chat. You can also attach files with 📎 if you're and admin.",
    position: "top",
  },
  /*{
    selector: "#memberList",
    title: "Members",
    body: "See who's online in this server. Right-click (or long-press on mobile) a member to send a DM or view their profile.",
    position: "left",
  },*/
  {
    selector: "#openSettingsBtn",
    title: "Settings",
    body: "Change your avatar, status, notification preferences, and appearance themes here.",
    position: "top",
  },
];

function startTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return; // already done

  let step = 0;

  // ── overlay pieces ──
  const overlay = document.createElement("div");
  overlay.id = "tutorialOverlay";
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "App tutorial");

  const spotlight = document.createElement("div");
  spotlight.id = "tutorialSpotlight";

  const card = document.createElement("div");
  card.id = "tutorialCard";

  const cardTitle = document.createElement("div");
  cardTitle.id = "tutorialCardTitle";

  const cardBody = document.createElement("div");
  cardBody.id = "tutorialCardBody";

  const cardFooter = document.createElement("div");
  cardFooter.id = "tutorialCardFooter";

  const skipBtn = document.createElement("button");
  skipBtn.className = "tutorial-btn tutorial-btn--skip";
  skipBtn.textContent = "Skip tour";
  skipBtn.addEventListener("click", endTutorial);

  const nextBtn = document.createElement("button");
  nextBtn.className = "tutorial-btn tutorial-btn--next";
  nextBtn.textContent = "Next →";
  nextBtn.addEventListener("click", () => advanceTutorial(step + 1));

  const dots = document.createElement("div");
  dots.id = "tutorialDots";

  cardFooter.appendChild(skipBtn);
  cardFooter.appendChild(dots);
  cardFooter.appendChild(nextBtn);
  card.appendChild(cardTitle);
  card.appendChild(cardBody);
  card.appendChild(cardFooter);
  overlay.appendChild(spotlight);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Keyboard: Esc to skip, right-arrow to advance
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") endTutorial();
    if (e.key === "ArrowRight") advanceTutorial(step + 1);
  });

  advanceTutorial(0);

  function advanceTutorial(newStep) {
    step = newStep;
    if (step >= TUTORIAL_STEPS.length) { endTutorial(); return; }

    const s = TUTORIAL_STEPS[step];
    const target = document.querySelector(s.selector);

    cardTitle.textContent = s.title;
    cardBody.innerHTML = s.body;
    nextBtn.textContent = step === TUTORIAL_STEPS.length - 1 ? "Finish 🎉" : "Next →";

    // Dots
    dots.innerHTML = "";
    TUTORIAL_STEPS.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "tutorial-dot" + (i === step ? " tutorial-dot--active" : "");
      dots.appendChild(dot);
    });

    if (!target) {
      // Skip steps whose target isn't in the DOM right now
      advanceTutorial(step + 1);
      return;
    }

    // Scroll target into view then position spotlight + card
    target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    requestAnimationFrame(() => positionTutorialStep(target, s.position));
  }

  function positionTutorialStep(target, position) {
    const rect = target.getBoundingClientRect();
    const PAD = 8;

    // Spotlight
    spotlight.style.left = (rect.left - PAD) + "px";
    spotlight.style.top = (rect.top - PAD) + "px";
    spotlight.style.width = (rect.width + PAD * 2) + "px";
    spotlight.style.height = (rect.height + PAD * 2) + "px";

    // Card
    const cw = 280, ch = 160;
    let cx, cy;
    if (position === "right") {
      cx = rect.right + 16;
      cy = rect.top + rect.height / 2 - ch / 2;
    } else if (position === "left") {
      cx = rect.left - cw - 16;
      cy = rect.top + rect.height / 2 - ch / 2;
    } else if (position === "top") {
      cx = rect.left + rect.width / 2 - cw / 2;
      cy = rect.top - ch - 16;
    } else { // bottom
      cx = rect.left + rect.width / 2 - cw / 2;
      cy = rect.bottom + 16;
    }

    // Clamp to viewport
    cx = Math.max(8, Math.min(cx, window.innerWidth - cw - 8));
    cy = Math.max(8, Math.min(cy, window.innerHeight - ch - 8));

    card.style.left = cx + "px";
    card.style.top = cy + "px";
  }

  function endTutorial() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    overlay.remove();
  }
}

function removeLocalStorageKey(key) {
  if (!key) {
    console.warn("⚠️ No key provided. Nothing removed.");
    return;
  }

  if (localStorage.getItem(key) !== null) {
    localStorage.removeItem(key);
    console.log(`✅ Removed key: "${key}"`);
  } else {
    console.log(`ℹ️ Key "${key}" did not exist.`);
  }
}



const MOBILE_TUTORIAL_STEPS = [
  {
    title: "👋 Welcome to LLA Chat!",
    body: "This quick tour shows you around. Tap <b>Next</b> to continue, or <b>Skip</b> to jump straight in.",
    highlightId: null,
  },
  {
    title: "📱 Open the Sidebar",
    body: "Tap the <b>☰ menu button</b> (top-left) to open your servers and channels. Let's open it now.",
    highlightId: "menuToggle",
    action: () => {
      // Programmatically open the sidebar the same way the menu button does
      const overlay = document.getElementById("sidebarOverlay");
      const channelSidebar = document.querySelector(".channel-sidebar");
      const serverSidebar = document.querySelector(".server-sidebar");
      if (overlay) overlay.classList.add("active");
      if (channelSidebar) channelSidebar.classList.add("open");
      if (serverSidebar) serverSidebar.classList.add("open");
    },
  },
  {
    title: "🗂️ Your Servers",
    body: "The icons on the far left are <b>servers</b> — like classrooms or clubs. Tap one to open it.",
    highlightId: "serverList",
  },
  {
    title: "💬 Channels",
    body: "Inside each server are <b>channels</b>. Text channels let you chat; voice channels let you talk live. Tap any channel name to open it.",
    highlightId: "channelList",
    action: () => {
      // Close sidebar after showing channels so next steps show the chat
      setTimeout(() => {
        const overlay = document.getElementById("sidebarOverlay");
        const channelSidebar = document.querySelector(".channel-sidebar");
        const serverSidebar = document.querySelector(".server-sidebar");
        if (overlay) overlay.classList.remove("active");
        if (channelSidebar) channelSidebar.classList.remove("open");
        if (serverSidebar) serverSidebar.classList.remove("open");
      }, 400);
    },
  },
  {
    title: "✉️ Direct Messages",
    body: "Want to message someone privately? Tap the <b>+ next to Direct Messages</b> in the sidebar to start a DM.",
    highlightId: "newDmBtn",
  },
  {
    title: "⌨️ Sending Messages",
    body: "Type in the <b>message box</b> at the bottom and tap <b>Send</b>. Use <b>📎</b> to attach a file, or type <b>@</b> to mention someone.",
    highlightId: "messageInput",
  },
  {
    title: "⚙️ Settings",
    body: "Tap <b>⚙️</b> (bottom-left) to change your avatar, status, notifications, and theme.",
    highlightId: "openSettingsBtn",
  },
  {
    title: "🎉 You're all set!",
    body: "That's the tour! Jump in and start chatting. You can always find help in the server settings.",
    highlightId: null,
  },
];

function startMobileTutorial() {
  if (localStorage.getItem(TUTORIAL_KEY)) return;

  let step = 0;

  // ── Build the sheet ──────────────────────────────────────────────────────
  const sheet = document.createElement("div");
  sheet.id = "mobileTutorialSheet";

  const handle = document.createElement("div");
  handle.className = "mts-handle";

  const stepCounter = document.createElement("div");
  stepCounter.className = "mts-counter";

  const title = document.createElement("div");
  title.className = "mts-title";

  const body = document.createElement("div");
  body.className = "mts-body";

  const footer = document.createElement("div");
  footer.className = "mts-footer";

  const skipBtn = document.createElement("button");
  skipBtn.className = "mts-btn mts-btn--skip";
  skipBtn.textContent = "Skip tour";
  skipBtn.addEventListener("click", endTutorial);

  const dots = document.createElement("div");
  dots.className = "mts-dots";

  const nextBtn = document.createElement("button");
  nextBtn.className = "mts-btn mts-btn--next";
  nextBtn.addEventListener("click", () => advanceStep(step + 1));

  footer.appendChild(skipBtn);
  footer.appendChild(dots);
  footer.appendChild(nextBtn);

  sheet.appendChild(handle);
  sheet.appendChild(stepCounter);
  sheet.appendChild(title);
  sheet.appendChild(body);
  sheet.appendChild(footer);
  document.body.appendChild(sheet);

  // ── Coach-mark highlight element (floats over highlighted element) ──────
  const coachMark = document.createElement("div");
  coachMark.id = "mobileTutorialCoachMark";
  document.body.appendChild(coachMark);

  // ── Swipe-down to skip ───────────────────────────────────────────────────
  let touchStartY = 0;
  sheet.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
  sheet.addEventListener("touchend", (e) => {
    const delta = e.changedTouches[0].clientY - touchStartY;
    if (delta > 60) endTutorial(); // swipe down 60px = dismiss
  }, { passive: true });

  advanceStep(0);

  function advanceStep(newStep) {
    step = newStep;
    if (step >= MOBILE_TUTORIAL_STEPS.length) { endTutorial(); return; }

    const s = MOBILE_TUTORIAL_STEPS[step];

    // Run any side-effect (open sidebar etc.) before showing the step
    if (s.action) s.action();

    // Update text
    stepCounter.textContent = `${step + 1} of ${MOBILE_TUTORIAL_STEPS.length}`;
    title.innerHTML = s.title;
    body.innerHTML = s.body;
    nextBtn.textContent = step === MOBILE_TUTORIAL_STEPS.length - 1 ? "Let's go! 🚀" : "Next →";

    // Dots
    dots.innerHTML = "";
    MOBILE_TUTORIAL_STEPS.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "mts-dot" + (i === step ? " mts-dot--active" : "");
      dots.appendChild(dot);
    });

    // Coach mark
    updateCoachMark(s.highlightId);

    // Slide sheet in
    sheet.classList.remove("mts-sheet--hidden");
    requestAnimationFrame(() => sheet.classList.add("mts-sheet--visible"));
  }

  function updateCoachMark(id) {
    coachMark.classList.remove("mts-coach--visible");

    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;

    // Only highlight if actually visible in viewport
    const rect = target.getBoundingClientRect();
    const inView = rect.width > 0 && rect.height > 0 &&
      rect.top >= 0 && rect.top <= window.innerHeight &&
      rect.left >= 0 && rect.left <= window.innerWidth;
    if (!inView) return;

    const PAD = 6;
    coachMark.style.left = (rect.left - PAD) + "px";
    coachMark.style.top = (rect.top - PAD + window.scrollY) + "px";
    coachMark.style.width = (rect.width + PAD * 2) + "px";
    coachMark.style.height = (rect.height + PAD * 2) + "px";

    requestAnimationFrame(() => coachMark.classList.add("mts-coach--visible"));
  }

  function endTutorial() {
    localStorage.setItem(TUTORIAL_KEY, "1");
    sheet.classList.remove("mts-sheet--visible");
    sheet.classList.add("mts-sheet--hidden");
    coachMark.classList.remove("mts-coach--visible");
    setTimeout(() => { sheet.remove(); coachMark.remove(); }, 280);
  }
}