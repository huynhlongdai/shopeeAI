if (!globalThis.__shopeeAiFacebookPublisherLoaded) {
  globalThis.__shopeeAiFacebookPublisherLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'prepare-facebook-post') {
      prepareFacebookPost(message.job)
        .then((result) => sendResponse({ ok: true, result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });
}

async function prepareFacebookPost(job) {
  renderPublisherPanel(job);
  await navigator.clipboard.writeText(normalizePostText(job.commentText || job.caption || '')).catch(() => {});
  if (job.publishMode !== 'auto') {
    return { ready: true, note: 'Draft mode: caption copied for manual publish.' };
  }

  if (job.type === 'facebook-comment') {
    return autoCommentOnFacebookPost(job);
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
      <strong>Type:</strong> ${escapeHtml(job.type || 'facebook-publish-post')}<br>
      <strong>Mode:</strong> ${escapeHtml(job.publishMode || 'draft')}<br>
      <strong>Affiliate:</strong> ${escapeHtml(job.affiliateLink || '')}
    </div>
    <textarea id="saifb-caption">${escapeHtml(normalizePostText(job.commentText || job.caption || ''))}</textarea>
    <div class="saifb-actions">
      <button id="saifb-copy-caption">Copy caption</button>
      <button id="saifb-copy-link" class="alt">Copy link</button>
      <button id="saifb-close" class="muted">Close</button>
    </div>
    <p id="saifb-status" style="margin-top:10px">${job.publishMode === 'auto' ? 'Auto mode is starting. The extension will open the composer, fill content, and click Post.' : 'Draft/manual mode copies the caption for review.'}</p>
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

async function autoCommentOnFacebookPost(job) {
  updatePanelStatus('Auto mode: finding Facebook comment box...');
  const commentBox = await waitForElement(findCommentTextbox, 15000, 'Facebook comment textbox not found.');
  const commentText = normalizePostText(job.commentText || job.caption || job.affiliateLink || '');
  await fillComposerText(commentBox, commentText);
  await sleep(1000);

  updatePanelStatus('Submitting comment...');
  const submitButton = findEnabledCommentButton();
  if (submitButton) {
    submitButton.click();
  } else {
    commentBox.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
  }
  await sleep(3500);

  updatePanelStatus('Comment submitted.');
  return {
    completed: true,
    commented: true,
    status: 'commented',
    commentUrl: location.href,
    note: 'Facebook comment was submitted by the extension.',
  };
}

async function autoPublishFacebookPost(job) {
  updatePanelStatus('Auto mode: opening Facebook composer...');
  const existingUrls = collectFacebookPostUrls();
  const existingShopeeLinkKeys = new Set(collectFacebookShopeeLinks(job.affiliateLink).map(linkIdentity));
  await openComposer();

  updatePanelStatus('Filling caption...');
  const textbox = await waitForElement(findComposerTextbox, 15000, 'Facebook composer textbox not found.');
  const caption = normalizePostText(job.caption || job.affiliateLink || '');
  await fillComposerText(textbox, caption);
  await sleep(1200);

  updatePanelStatus('Advancing Facebook publish flow...');
  await advancePublishFlow(caption);

  updatePanelStatus('Waiting for Facebook post URL...');
  const facebookPostUrl = await waitForPostUrl(existingUrls, 35000).catch(() => '');
  if (facebookPostUrl) {
    const facebookShopeeLinks = await waitForFacebookShopeeLinks(job.affiliateLink, existingShopeeLinkKeys, 45000)
      .catch(() => collectFacebookShopeeLinks(job.affiliateLink).filter((row) => !existingShopeeLinkKeys.has(linkIdentity(row))));
    const primaryShopeeLink = facebookShopeeLinks[0] || {};
    updatePanelStatus(`Published: ${facebookPostUrl}`);
    return {
      published: true,
      facebookPostUrl,
      facebookShopeeLinks,
      visibleShopeeLink: primaryShopeeLink.visibleShopeeLink || '',
      facebookTrackedShopeeLink: primaryShopeeLink.facebookTrackedShopeeLink || primaryShopeeLink.url || '',
      facebookWrappedShopeeLink: primaryShopeeLink.facebookTrackedShopeeLink || primaryShopeeLink.url || '',
      cleanShopeeLink: primaryShopeeLink.cleanShopeeLink || primaryShopeeLink.targetUrl || '',
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

function findCommentTextbox() {
  const boxes = visibleElements('[role="textbox"][contenteditable="true"], div[contenteditable="true"]')
    .filter((node) => !node.closest('#saifb-panel'));
  return boxes.find((node) => /comment|bình luận/i.test(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`))
    || boxes.at(-1);
}

async function fillComposerText(textbox, text) {
  const normalizedText = normalizePostText(text);
  if (!normalizedText) throw new Error('Facebook caption/comment is empty.');

  textbox.focus();
  await sleep(150);

  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('insertText', false, normalizedText);
  dispatchComposerInputEvents(textbox, normalizedText);
  if (await waitForComposerText(textbox, normalizedText, 1600).catch(() => false)) return true;

  await navigator.clipboard.writeText(normalizedText).catch(() => {});
  textbox.focus();
  await sleep(100);
  document.execCommand('selectAll', false, null);
  document.execCommand('delete', false, null);
  document.execCommand('paste', false, null);
  dispatchComposerInputEvents(textbox, normalizedText);
  if (await waitForComposerText(textbox, normalizedText, 1600).catch(() => false)) return true;

  textbox.focus();
  textbox.textContent = normalizedText;
  dispatchComposerInputEvents(textbox, normalizedText);
  if (await waitForComposerText(textbox, normalizedText, 1600).catch(() => false)) return true;

  throw new Error('Facebook composer did not receive the caption. Publish was stopped before clicking Post.');
}

function dispatchComposerInputEvents(textbox, text) {
  textbox.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: text }));
  textbox.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  textbox.dispatchEvent(new Event('change', { bubbles: true }));
}

async function waitForComposerText(textbox, expectedText, timeoutMs) {
  return waitForElement(() => composerContainsExpectedText(textbox, expectedText), timeoutMs, 'Facebook composer text was not inserted.');
}

function composerContainsExpectedText(textbox, expectedText) {
  const actual = normalizeText(textbox.innerText || textbox.textContent || '');
  const expected = normalizeText(expectedText);
  if (!actual || !expected) return false;
  if (actual.includes(expected)) return true;

  const expectedShopeeLink = extractShopeeUrlFromText(expected);
  if (expectedShopeeLink && actual.includes(expectedShopeeLink)) return true;

  const meaningfulWords = expected
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !/^https?:\/\//i.test(word))
    .slice(0, 4);
  return meaningfulWords.length > 0 && meaningfulWords.every((word) => actual.includes(word));
}

function findEnabledPostButton() {
  return findEnabledButton(/^(post|đăng|publish|share|chia sẻ)$/i);
}

function findEnabledNextButton() {
  return findEnabledButton(/^(next|tiếp)$/i);
}

function findEnabledCommentButton() {
  return findEnabledButton(/^(comment|bình luận|đăng bình luận|send|gửi)(\s|$)/i);
}

function findEnabledButton(pattern) {
  return visibleElements('[role="button"], button')
    .filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.top <= window.innerHeight && rect.width > 0 && rect.height > 0;
    })
    .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)
    .find((node) => {
      const text = normalizeButtonLabel(node);
      const disabled = node.getAttribute('aria-disabled') === 'true' || node.disabled;
      return !disabled && pattern.test(text);
    });
}

function normalizeButtonLabel(node) {
  let text = normalizeText(`${node.getAttribute('aria-label') || ''} ${node.textContent || ''}`);
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.length % 2 === 0) {
    const half = parts.length / 2;
    const first = parts.slice(0, half).join(' ');
    const second = parts.slice(half).join(' ');
    if (first === second) text = first;
  }
  return text;
}

function normalizePostText(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

async function advancePublishFlow(expectedText) {
  const directPostButton = findEnabledPostButton();
  if (directPostButton) {
    assertAnyComposerContainsText(expectedText);
    directPostButton.click();
    return;
  }

  const nextButton = await waitForElement(findEnabledNextButton, 15000, 'Facebook Next button not found or still disabled.');
  assertAnyComposerContainsText(expectedText);
  nextButton.click();
  await sleep(1800);

  const postButton = await waitForElement(findEnabledPostButton, 15000, 'Facebook Post button not found after Next.');
  assertAnyComposerContainsText(expectedText, { allowMissingComposer: true });
  postButton.click();
}

function assertAnyComposerContainsText(expectedText, options = {}) {
  const boxes = visibleElements('[role="dialog"] [role="textbox"][contenteditable="true"], [role="dialog"] div[contenteditable="true"], [role="textbox"][contenteditable="true"]')
    .filter((node) => !node.closest('#saifb-panel'));
  if (!boxes.length && options.allowMissingComposer) return;
  if (boxes.some((box) => composerContainsExpectedText(box, expectedText))) return;
  throw new Error('Facebook composer is empty or missing expected content. Publish was stopped before clicking Post.');
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

function collectFacebookShopeeLinks(affiliateLink = '') {
  const wanted = normalizeShopeeComparableUrl(affiliateLink);
  const rows = [...document.querySelectorAll('a[href]')]
    .map((anchor) => {
      const url = new URL(anchor.getAttribute('href') || '', location.href).toString();
      const targetUrl = extractFacebookOutboundUrl(url);
      const text = normalizeText(anchor.textContent);
      const visibleShopeeLink = extractShopeeUrlFromText(text);
      const cleanShopeeLink = normalizeShopeeComparableUrl(targetUrl || url || visibleShopeeLink);
      return {
        url,
        facebookTrackedShopeeLink: url,
        targetUrl,
        cleanShopeeLink,
        visibleShopeeLink,
        text,
      };
    })
    .filter((row) => {
      const comparable = normalizeShopeeComparableUrl(row.targetUrl || row.url || row.visibleShopeeLink);
      if (!comparable) return false;
      return !wanted || comparable === wanted || comparable.includes(wanted) || wanted.includes(comparable);
    });

  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.url}|${row.targetUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function waitForFacebookShopeeLinks(affiliateLink, existingKeys, timeoutMs) {
  return waitForElement(() => {
    const rows = collectFacebookShopeeLinks(affiliateLink).filter((row) => !existingKeys.has(linkIdentity(row)));
    return rows.length ? rows : null;
  }, timeoutMs, 'Facebook tracked Shopee link was not found.');
}

function linkIdentity(row) {
  return row?.facebookTrackedShopeeLink || row?.url || row?.targetUrl || row?.visibleShopeeLink || '';
}

function extractShopeeUrlFromText(value) {
  return String(value || '').match(/https?:\/\/(?:[^/\s]+\.)?(?:shopee\.vn|s\.shopee\.vn|shope\.ee)[^\s<>"')]+/i)?.[0] || '';
}

function extractFacebookOutboundUrl(value) {
  try {
    const url = new URL(value, location.href);
    const nested = url.searchParams.get('u');
    return nested ? decodeURIComponent(nested) : url.toString();
  } catch {
    return String(value || '');
  }
}

function normalizeShopeeComparableUrl(value) {
  const text = String(value || '').trim();
  if (!/(^https?:\/\/)?([^/]+\.)?(shopee\.vn|s\.shopee\.vn|shope\.ee)/i.test(text)) return '';
  try {
    const url = new URL(text);
    url.hash = '';
    ['fbclid', 'content_source', 'fb_content_id', 'encrypted_payload', 'channel_type', 'content_type'].forEach((key) =>
      url.searchParams.delete(key),
    );
    return url.toString().replace(/\/$/, '');
  } catch {
    return text.replace(/\/$/, '');
  }
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
