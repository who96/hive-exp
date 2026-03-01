// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    loadTab(btn.dataset.tab);
  });
});

async function fetchApi(path) {
  const res = await fetch('/api' + path);
  return res.json();
}

async function loadTab(tab) {
  if (tab === 'overview') loadOverview();
  else if (tab === 'experiences') loadExperiences();
  else if (tab === 'events') loadEvents();
}

// Overview
async function loadOverview() {
  const el = document.getElementById('overview-content');
  el.innerHTML = '<p>Loading...</p>';
  const resp = await fetchApi('/overview');
  if (resp.status !== 'ok') { el.innerHTML = '<p>Error loading overview</p>'; return; }
  const d = resp.data;
  el.innerHTML = `
    <div class="stat-card"><div class="value">${d.total_experiences}</div><div class="label">Total Experiences</div></div>
    <div class="stat-card"><div class="value">${d.provisional_count}</div><div class="label">Provisional</div></div>
    <div class="stat-card"><div class="value">${d.promoted_count}</div><div class="label">Promoted</div></div>
    <div class="stat-card"><div class="value">${d.archived_count}</div><div class="label">Archived</div></div>
    <div class="stat-card"><div class="value">${d.pending_review}</div><div class="label">Pending Review</div></div>
    <div class="stat-card"><div class="value">${d.recent_events}</div><div class="label">Events (24h)</div></div>
  `;
  if (d.agents && d.agents.length > 0) {
    const tbl = document.getElementById('agents-content');
    if (tbl) {
      tbl.innerHTML = `<table class="table"><thead><tr><th>Agent</th><th>Experiences</th></tr></thead><tbody>
        ${d.agents.map(a => `<tr><td>${a.name}</td><td>${a.experience_count}</td></tr>`).join('')}
      </tbody></table>`;
    }
  }
}

// Experiences
async function loadExperiences() {
  const status = document.getElementById('filter-status')?.value || '';
  const agent = document.getElementById('filter-agent')?.value || '';
  const limit = document.getElementById('filter-limit')?.value || '50';
  const el = document.getElementById('experiences-content');
  el.innerHTML = '<p>Loading...</p>';
  let url = `/experiences?limit=${limit}`;
  if (status) url += `&status=${status}`;
  if (agent) url += `&agent=${encodeURIComponent(agent)}`;
  const resp = await fetchApi(url);
  if (resp.status !== 'ok') { el.innerHTML = '<p>Error loading experiences</p>'; return; }
  const items = resp.data.items || [];
  if (items.length === 0) { el.innerHTML = '<p>No experiences found</p>'; return; }
  el.innerHTML = `<table class="table">
    <thead><tr><th>ID</th><th>Status</th><th>Agent</th><th>Strategy</th><th>Confidence</th><th>Actions</th></tr></thead>
    <tbody>
      ${items.map(r => `<tr>
        <td>${r.id}</td>
        <td><span class="badge badge-${r._status}">${r._status}</span></td>
        <td>${r.source_agent}</td>
        <td>${r.strategy?.name || ''}</td>
        <td>${(r.confidence * 100).toFixed(0)}%</td>
        <td>
          ${r._status === 'provisional' ? `<button class="btn btn-promote" onclick="promoteExp('${r.id}')">Promote</button>` : ''}
          ${r._status !== 'archived' ? `<button class="btn btn-quarantine" onclick="quarantineExp('${r.id}')">Quarantine</button>` : ''}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

async function promoteExp(id) {
  const resp = await fetch(`/api/experience/${id}/promote`, { method: 'POST' });
  const data = await resp.json();
  if (data.status === 'ok') loadExperiences();
  else alert('Error: ' + data.message);
}

async function quarantineExp(id) {
  if (!confirm('Quarantine this experience?')) return;
  const resp = await fetch(`/api/experience/${id}/quarantine`, { method: 'POST' });
  const data = await resp.json();
  if (data.status === 'ok') loadExperiences();
  else alert('Error: ' + data.message);
}

// Events
async function loadEvents() {
  const type = document.getElementById('filter-event-type')?.value || '';
  const since = document.getElementById('filter-since')?.value || '';
  const limit = document.getElementById('filter-event-limit')?.value || '100';
  const el = document.getElementById('events-content');
  el.innerHTML = '<p>Loading...</p>';
  let url = `/events?limit=${limit}`;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const resp = await fetchApi(url);
  if (resp.status !== 'ok') { el.innerHTML = '<p>Error loading events</p>'; return; }
  const items = resp.data.items || [];
  if (items.length === 0) { el.innerHTML = '<p>No events found</p>'; return; }
  el.innerHTML = `<ul class="timeline">
    ${items.map(e => `<li class="timeline-item" onclick="this.classList.toggle('expanded')">
      <div class="event-type">${e.type}</div>
      <div style="color: var(--text-dim); font-size: 0.8rem">${e.timestamp} — ${e.source_agent}</div>
      <div class="event-payload">${JSON.stringify(e.payload, null, 2)}</div>
    </li>`).join('')}
  </ul>`;
}

loadTab('overview');
