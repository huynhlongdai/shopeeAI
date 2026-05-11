const enabled = document.querySelector('#enabled');
const status = document.querySelector('#status');
const summary = document.querySelector('#summary');
const serverPill = document.querySelector('#serverPill');

init();

document.querySelector('#manager').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'open-manager' }));
document.querySelector('#collect').addEventListener('click', () => callBackground({ type: 'collect-current-tab' }, 'Collected current tab.'));
document.querySelector('#poll').addEventListener('click', () => callBackground({ type: 'poll-now' }, 'Queue run requested.'));
enabled.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: enabled.checked });
  await render();
});

async function init() {
  const settings = await chrome.storage.local.get({ enabled: true });
  enabled.checked = Boolean(settings.enabled);
  await render();
}

async function callBackground(message, okText) {
  status.textContent = 'Working...';
  const response = await chrome.runtime.sendMessage(message);
  status.textContent = response?.ok ? okText : response?.error || 'Failed.';
  await render();
}

async function render() {
  const response = await chrome.runtime.sendMessage({ type: 'get-dashboard' }).catch((error) => ({ ok: false, error: error.message }));
  if (!response?.ok) {
    serverPill.textContent = 'Offline';
    summary.textContent = response?.error || 'Dashboard unavailable.';
    return;
  }

  const data = response.result;
  serverPill.textContent = data.server?.ok ? 'Online' : 'Offline';
  const jobs = data.jobs || [];
  const product = data.latestProductData;
  summary.innerHTML = `
    <div><strong>Profile:</strong> ${escapeHtml(data.settings?.profileId || 'profile-1')}</div>
    <div><strong>Latest:</strong> ${escapeHtml(product?.name || 'None')}</div>
    <div>${product?.images?.length || 0} images · ${product?.videos?.length || 0} videos</div>
    <hr>
    ${
      jobs
        .slice(0, 4)
        .map((job) => `<div class="job-row"><span>#${escapeHtml(job.id)} ${escapeHtml(job.type)}</span><span>${escapeHtml(job.status)}</span></div>`)
        .join('') || '<div>No jobs.</div>'
    }
  `;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
