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
  return { ready: true };
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
    <p style="margin-top:10px">Open Facebook composer, paste the caption, review, then publish. Auto-publish will be added after composer detection is verified.</p>
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
