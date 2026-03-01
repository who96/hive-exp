document.addEventListener('DOMContentLoaded', init);

const loadedTabs = new Set();

function setActiveTab(tabId) {
  const tabs = document.querySelectorAll('.nav-tab');
  const sections = document.querySelectorAll('.tab-content');

  tabs.forEach((tab) => {
    if (tab instanceof HTMLElement) {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    }
  });

  sections.forEach((section) => {
    if (section instanceof HTMLElement) {
      section.classList.toggle('active', section.id === tabId);
    }
  });
}

async function init() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', async (event) => {
      event.preventDefault();
      const tabId = tab.dataset.tab;
      if (!tabId) {
        return;
      }

      setActiveTab(tabId);
      await loadTabData(tabId);
    });
  });

  await loadOverview();
}

async function fetchApi(endpoint) {
  try {
    const res = await fetch(`/api/${endpoint}`);
    const data = await res.json();
    return data;
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

function renderJson(sectionId, payload) {
  const section = document.getElementById(sectionId);
  if (!section) {
    return;
  }

  section.innerHTML = `
    <div class="card">
      <pre>${JSON.stringify(payload, null, 2)}</pre>
    </div>
  `;
}

async function loadOverview() {
  const data = await fetchApi('overview');
  renderJson('tab-overview', data);
}

async function loadExperiences() {
  const data = await fetchApi('experiences');
  renderJson('tab-experiences', data);
}

async function loadAuditLog() {
  const data = await fetchApi('events');
  renderJson('tab-audit', data);
}

async function loadStats() {
  const data = await fetchApi('stats');
  renderJson('tab-stats', data);
}

async function loadTabData(tabId) {
  if (loadedTabs.has(tabId)) {
    return;
  }

  switch (tabId) {
    case 'tab-overview':
      await loadOverview();
      break;
    case 'tab-experiences':
      await loadExperiences();
      break;
    case 'tab-audit':
      await loadAuditLog();
      break;
    case 'tab-stats':
      await loadStats();
      break;
    default:
      return;
  }

  loadedTabs.add(tabId);
}
