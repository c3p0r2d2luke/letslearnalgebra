// ad.js — lightweight ad inserter
// Inserts a non-intrusive "AD" message every N messages.
(function(){
  if (window.adManager) return; // idempotent
  const AD_INTERVAL = 7; // every 7 messages
  const ads = [
    { title: 'AD', body: 'Try Acme Widgets — make math fun! Visit example.com' },
    { title: 'AD', body: 'Learn algebra faster with ShortCourses — sign up today.' },
    { title: 'AD', body: 'Sponsor: Friendly Tutors — 10% off your first lesson.' }
  ];
  let adIndex = 0;

  function createAdElement() {
    const li = document.createElement('li');
    li.className = 'ad-message';
    const wrapper = document.createElement('div');
    wrapper.className = 'message-row';

    const body = document.createElement('div');
    body.className = 'message-body';

    const header = document.createElement('div');
    header.className = 'username';
    header.innerHTML = `<strong>AD</strong><span class="msg-timestamp">&nbsp;</span>`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    const ad = ads[adIndex % ads.length];
    adIndex++;
    contentDiv.textContent = ad.body;

    body.appendChild(header);
    body.appendChild(contentDiv);
    wrapper.appendChild(body);
    li.appendChild(wrapper);
    // Mark so ad-manager can detect
    li.dataset.ad = '1';
    return li;
  }

  function countUserMessages() {
    const messagesList = document.getElementById('messages');
    if (!messagesList) return 0;
    // count items that are not ads
    return Array.from(messagesList.children).filter(li => !li.dataset.ad).length;
  }

  function lastIsAd() {
    const messagesList = document.getElementById('messages');
    if (!messagesList || messagesList.children.length === 0) return false;
    const last = messagesList.children[messagesList.children.length - 1];
    return !!last.dataset.ad;
  }

  function maybeInsertAd() {
    try {
      const messagesList = document.getElementById('messages');
      if (!messagesList) return;
      const count = countUserMessages();
      // Insert ad when count is a multiple of AD_INTERVAL and last element is not an ad
      if (count > 0 && count % AD_INTERVAL === 0 && !lastIsAd()) {
        const adEl = createAdElement();
        messagesList.appendChild(adEl);
        // keep scroll behavior consistent
        messagesList.scrollTop = messagesList.scrollHeight;
      }
    } catch (e) {
      console.warn('adManager error', e);
    }
  }

  window.adManager = {
    maybeInsertAd
  };
})();
