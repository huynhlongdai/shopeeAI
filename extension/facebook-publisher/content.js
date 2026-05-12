chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'prepare-facebook-post') {
    prepareFacebookPost(message.job)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  return false;
});

async function prepareFacebookPost(job) {
  renderPublisherPanel(job);
  await navigator.clipboard.writeText(job.caption || '');
  if (job.publishMode !== 'auto') {
    return { ready: true, note: 'Draft mode: caption copied for manual publish.' };
  }

  return autoPublishFacebookPost(job);
}

function renderPublisherPanel(job) {
  document.getElementById('saifb-panel')?.remove();
  const style = document.getElementById('saifb-style') || document.createElement('style');
  style.id = 'saifb-style';
  style.textContent = `
    #saifb-panel {
      background: #fff;
      border: 1px solid rgba(15, 23, 42, .16);
      border-radius: 10px;
      bottom: 24px;
      box-shadow: 0 18px 42px rgba(15, 23, 42, .18);
      color: #172033;
      font: 13px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-height: min(620px, calc(100vh - 48px));
      overflow: auto;
      padding: 12px;
      position: fixed;
      right: 24px;
      width: min(420px, calc(100vw - 48px));
      z-index: 2147483647;
    }
    #saifb-panel * { box-sizing: border-box; }
    #saifb-panel h2 { font-size: 16px; margin: 0 0 6px; }
    #saifb-panel p { color: #64748b; margin: 0 0 10px; }
    #saifb-panel textarea {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      color: #172033;
      font: inherit;
      min-height: 180px;
      padding: 9px;
      resize: vertical;
      width: 100%;
    }
    .saifb-actions { display: grid; gap: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 10px; }
    .saifb-actions button {
      background: #1877f2;
      border: 0;
      border-radius: 8px;
      color: #fff;
      cursor: pointer;
      font: inherit;
      padding: 8px 10px;
    }
    .saifb-actions button.alt { background: #1f8a5b; }
    .saifb-actions button.muted { background: #64748b; }
    .saifb-meta {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin: 10px 0;
      padding: 8px;
      overflow-wrap: anywhere;
    }
  `;
  document.documentElement.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'saifb-panel';
  panel.innerHTML = `
    <h2>shopeeAI Facebook Publisher</h2>
    <p>Job ${escapeHtml(job.id)} is ready. Caption was copied to clipboard.</p>
    <div class="saifb-meta">
      <strong>Mode:</strong> ${escapeHtml(job.publishMode || 'draft')}<br>
      <strong>Affiliate:</strong> ${escapeHtml(job.affiliateLink || '')}
    </div>
    <textarea id="saifb-caption">${escapeHtml(job.caption || '')}</textarea>
    <div class="saifb-actions">
      <button id="saifb-copy-caption">Copy caption</button>
      <button id="saifb-copy-link" class="alt">Copy link</button>
      <button id="saifb-close" class="muted">Close</button>
    </div>
    <p id="saifb-status" style="margin-top:10px">Draft mode copies the caption. Auto mode opens the composer, fills content, and clicks Post.</p>
  `;
  document.documentElement.appendChild(panel);

  panel.querySelector('#saifb-copy-caption').addEventListener('click', async () => {
    await navigator.clipboard.writeText(panel.querySelector('#saifb-caption').value);
  });
  panel.querySelector('#saifb-copy-link').addEventListener('click', async () => {
    await navigator.clipboard.writeText(job.affiliateLink || '');
  });
  panel.querySelector('#saifb-close').addEventListener('click', () => panel.remove());
}

async function autoPublishFacebookPost(job) {
  updatePanelStatus('Auto mode: opening Facebook composer...');
  const existingUrls = collectFacebookPostUrls();
  await openComposer();

  updatePanelStatus('Filling caption...');
  const textbox = await waitForElement(findComposerTextbox, 15000, 'Facebook composer textbox not found.');
  setComposerText(textbox, job.caption || job.affiliateLink || '');
  await sleep(1200);

  updatePanelStatus('Publishing post...');
  const postButton = await waitForElement(findEnabledPostButton, 15000, 'Facebook Post button not found or still disabled.');
  postButton.click();

  updatePanelStatus('Waiting for Facebook post URL...');
  const facebookPostUrl = await waitForPostUrl(existingUrls, 35000).catch(() => '');
  if (facebookPostUrl) {
    updatePanelStatus(`Published: ${facebookPostUrl}`);
    return {
      published: true,
      facebookPostUrl,
      note: 'Auto-published and post URL detected.',
    };
  }

  updatePanelStatus('Posted click sent, but post URL was not detected yet.');
  return {
    published: false,
    status: 'published_pending_url',
    facebookPostUrl: '',
    note: 'Auto-publish click was sent, but Facebook post URL was not detected. Open the page to confirm and complete embedded URL manually.',
  };
}

async function openComposer() {
  const starter = findComposerStarter();
  if (!starter) throw new Error('Facebook composer starter not found.');
  starter.click();
  await sleep(1000);
}

function findComposerStarter() {
  const candidates = visibleElements('[role="button"], [aria-label], span, div')
    .filter((node) => {
      const text = normalizeText(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`);
      return /what'?s on your mind|create post|write something|start a post|tạo bài viết|bạn đang nghĩ gì|viết gì đó|bạn muốn chia sẻ/i.test(text);
    });
  return candidates.find((node) => node.getAttribute('role') === 'button')
    || candidates.map((node) => node.closest('[role="button"]')).find(Boolean)
    || candidates[0];
}

function findComposerTextbox() {
  return visibleElements('[role="dialog"] [role="textbox"][contenteditable="true"], [role="dialog"] div[contenteditable="true"], [role="textbox"][contenteditable="true"]')
    .find((node) => !node.closest('#saifb-panel') && !/search|tìm kiếm/i.test(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`));
}

function setComposerText(textbox, text) {
  textbox.focus();
  document.execCommand('selectAll', false, null);
  document.execCommand('insertText', false, text);
  textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  textbox.dispatchEvent(new Event('change', { bubbles: true }));
}

function findEnabledPostButton() {
  const dialog = visibleElements('[role="dialog"]').at(-1) || document;
  return visibleElements('[role="button"], button', dialog)
    .find((node) => {
      const text = normalizeText(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`);
      const disabled = node.getAttribute('aria-disabled') === 'true' || node.disabled;
      return !disabled && /^(post|đăng|publish|share|chia sẻ)(\s|$)/i.test(text);
    });
}

async function waitForPostUrl(existingUrls, timeoutMs) {
  const existing = new Set(existingUrls);
  return waitForElement(() => {
    const currentUrl = normalizeFacebookPostUrl(location.href);
    if (currentUrl && !existing.has(currentUrl)) return currentUrl;
    const urls = collectFacebookPostUrls();
    return urls.find((url) => !existing.has(url)) || '';
  }, timeoutMs, 'Facebook post URL not found.');
}

function collectFacebookPostUrls() {
  return unique([...document.querySelectorAll('a[href]')]
    .map((anchor) => normalizeFacebookPostUrl(anchor.href))
    .filter(Boolean));
}

function normalizeFacebookPostUrl(value) {
  try {
    const url = new URL(value, location.href);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
    const text = url.toString();
    if (!/\/posts\/|\/permalink\/|story_fbid=|\/videos\/|\/reel\//i.test(text)) return '';
    url.hash = '';
    ['__cft__', '__tn__', 'comment_id', 'reply_comment_id', 'notif_id', 'notif_t'].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return '';
  }
}

function visibleElements(selector, root = document) {
  return [...root.querySelectorAll(selector)].filter(isVisible);
}

function isVisible(node) {
  if (!node || !(node instanceof Element)) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
}

function waitForElement(finder, timeoutMs, errorMessage) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const result = finder();
      if (result) {
        resolve(result);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        reject(new Error(errorMessage));
        return;
      }
      setTimeout(tick, 350);
    };
    tick();
  });
}

function updatePanelStatus(message) {
  const status = document.getElementById('saifb-status');
  if (status) status.textContent = message;
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
