// --- i18n ---
const I18N = {
  en: {
    page_title: 'Hive Exp Dashboard',
    page_subtitle: 'Operational view of experiences, events, and moderation actions.',
    tab_overview: 'Overview', tab_experiences: 'Experiences',
    tab_events: 'Audit Log', tab_stats: 'Stats',
    total_experiences: 'Total Experiences', provisional: 'Provisional',
    promoted: 'Promoted', archived: 'Archived',
    pending_review: 'Pending Review', events_24h: 'Events (24h)',
    agents: 'Agents', agent: 'Agent', experiences_col: 'Experiences',
    id: 'ID', status: 'Status', status_all: 'All', strategy: 'Strategy',
    confidence: 'Confidence', actions: 'Actions',
    promote: 'Promote', quarantine: 'Quarantine',
    confirm_quarantine: 'Quarantine this experience?',
    no_experiences: 'No experiences found',
    type: 'Type', since: 'Since', limit: 'Limit', apply: 'Apply',
    no_events: 'No events found',
    strategy_stats: 'Strategy Statistics',
    strategy_leaderboard: 'Strategy Leaderboard',
    at_risk: 'At-Risk Experiences', agent_contributions: 'Agent Contributions',
    ref_count: 'Ref Count', success_rate: 'Success Rate',
    avg_confidence: 'Avg Confidence', risk_reason: 'Risk Reason',
    signals: 'Signals', no_data: 'No data', count: 'Count',
    no_at_risk: 'No at-risk experiences found.',
    chart_success_rate: 'Success Rate (%)',
    chart_high: 'High (≥0.7)', chart_medium: 'Medium (0.3–0.7)', chart_low: 'Low (<0.3)',
    loading: 'Loading...', error_loading: 'Error loading',
  },
  zh: {
    page_title: 'Hive 经验管理面板',
    page_subtitle: '经验、事件与审核操作的运营视图。',
    tab_overview: '概览', tab_experiences: '经验库',
    tab_events: '审计日志', tab_stats: '统计',
    total_experiences: '总经验数', provisional: '待审核',
    promoted: '已推广', archived: '已归档',
    pending_review: '待审阅', events_24h: '近24h事件',
    agents: 'Agent 列表', agent: 'Agent', experiences_col: '经验数',
    id: 'ID', status: '状态', status_all: '全部', strategy: '策略',
    confidence: '置信度', actions: '操作',
    promote: '推广', quarantine: '隔离',
    confirm_quarantine: '确定要隔离这条经验吗？',
    no_experiences: '暂无经验记录',
    type: '类型', since: '起始时间', limit: '条数', apply: '筛选',
    no_events: '暂无事件',
    strategy_stats: '策略统计',
    strategy_leaderboard: '策略排行榜',
    at_risk: '风险经验', agent_contributions: 'Agent 贡献',
    ref_count: '引用次数', success_rate: '成功率',
    avg_confidence: '平均置信度', risk_reason: '风险原因',
    signals: '信号', no_data: '暂无数据', count: '数量',
    no_at_risk: '暂无风险经验。',
    chart_success_rate: '成功率 (%)',
    chart_high: '高 (≥0.7)', chart_medium: '中 (0.3–0.7)', chart_low: '低 (<0.3)',
    loading: '加载中...', error_loading: '加载失败',
  }
};

let _lang = localStorage.getItem('hive-lang') || 'en';
function t(key) { return I18N[_lang]?.[key] ?? I18N.en[key] ?? key; }

// --- Data cache ---
let _overviewData = null;
let _experiencesData = null;
let _eventsData = null;
let _statsData = null;

// --- Chart instances ---
let _chartRanking = null;
let _chartConfidence = null;

// --- API helper ---
async function fetchApi(path) {
  const res = await fetch('/api' + path);
  return res.json();
}

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
    loadTab(btn.dataset.tab);
  });
});

function loadTab(tab) {
  if (tab === 'overview') loadOverview();
  else if (tab === 'experiences') loadExperiences();
  else if (tab === 'events') loadEvents();
  else if (tab === 'stats') loadStats();
}

// --- Overview ---
async function loadOverview() {
  const el = document.getElementById('overview-content');
  el.innerHTML = `<p>${t('loading')}</p>`;
  const resp = await fetchApi('/overview');
  if (resp.status !== 'ok') { el.innerHTML = `<p>${t('error_loading')}</p>`; return; }
  _overviewData = resp.data;
  renderOverview();
}

function renderOverview() {
  if (!_overviewData) return;
  const d = _overviewData;
  const el = document.getElementById('overview-content');
  el.innerHTML = [
    ['total_experiences', d.total_experiences],
    ['provisional', d.provisional_count],
    ['promoted', d.promoted_count],
    ['archived', d.archived_count],
    ['pending_review', d.pending_review],
    ['events_24h', d.recent_events],
  ].map(([key, val]) =>
    `<div class="stat-card"><div class="value">${val}</div><div class="label">${t(key)}</div></div>`
  ).join('');

  if (d.agents && d.agents.length > 0) {
    const tbl = document.getElementById('agents-content');
    if (tbl) {
      tbl.innerHTML = `<table class="table"><thead><tr><th>${t('agent')}</th><th>${t('experiences_col')}</th></tr></thead><tbody>
        ${d.agents.map(a => `<tr><td>${a.name}</td><td>${a.experience_count}</td></tr>`).join('')}
      </tbody></table>`;
    }
  }
}

// --- Experiences ---
async function loadExperiences() {
  const status = document.getElementById('filter-status')?.value || '';
  const agent = document.getElementById('filter-agent')?.value || '';
  const limit = document.getElementById('filter-limit')?.value || '50';
  const el = document.getElementById('experiences-content');
  el.innerHTML = `<p>${t('loading')}</p>`;
  let url = `/experiences?limit=${limit}`;
  if (status) url += `&status=${status}`;
  if (agent) url += `&agent=${encodeURIComponent(agent)}`;
  const resp = await fetchApi(url);
  if (resp.status !== 'ok') { el.innerHTML = `<p>${t('error_loading')}</p>`; return; }
  _experiencesData = resp.data;
  renderExperiences();
}

function renderExperiences() {
  if (!_experiencesData) return;
  const items = _experiencesData.items || [];
  const el = document.getElementById('experiences-content');
  if (items.length === 0) { el.innerHTML = `<p>${t('no_experiences')}</p>`; return; }
  el.innerHTML = `<table class="table">
    <thead><tr><th>${t('id')}</th><th>${t('status')}</th><th>${t('agent')}</th><th>${t('strategy')}</th><th>${t('confidence')}</th><th>${t('actions')}</th></tr></thead>
    <tbody>
      ${items.map(r => `<tr>
        <td>${r.id}</td>
        <td><span class="badge badge-${r._status}">${t(r._status)}</span></td>
        <td>${r.source_agent}</td>
        <td>${r.strategy?.name || ''}</td>
        <td>${(r.confidence * 100).toFixed(0)}%</td>
        <td>
          ${r._status === 'provisional' ? `<button class="btn btn-promote" onclick="promoteExp('${r.id}')">${t('promote')}</button>` : ''}
          ${r._status !== 'archived' ? `<button class="btn btn-quarantine" onclick="quarantineExp('${r.id}')">${t('quarantine')}</button>` : ''}
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
  if (!confirm(t('confirm_quarantine'))) return;
  const resp = await fetch(`/api/experience/${id}/quarantine`, { method: 'POST' });
  const data = await resp.json();
  if (data.status === 'ok') loadExperiences();
  else alert('Error: ' + data.message);
}

// --- Events ---
async function loadEvents() {
  const type = document.getElementById('filter-event-type')?.value || '';
  const since = document.getElementById('filter-since')?.value || '';
  const limit = document.getElementById('filter-event-limit')?.value || '100';
  const el = document.getElementById('events-content');
  el.innerHTML = `<p>${t('loading')}</p>`;
  let url = `/events?limit=${limit}`;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  if (since) url += `&since=${encodeURIComponent(since)}`;
  const resp = await fetchApi(url);
  if (resp.status !== 'ok') { el.innerHTML = `<p>${t('error_loading')}</p>`; return; }
  _eventsData = resp.data;
  renderEvents();
}

function renderEvents() {
  if (!_eventsData) return;
  const items = _eventsData.items || [];
  const el = document.getElementById('events-content');
  if (items.length === 0) { el.innerHTML = `<p>${t('no_events')}</p>`; return; }
  el.innerHTML = `<ul class="timeline">
    ${items.map(e => `<li class="timeline-item" onclick="this.classList.toggle('expanded')">
      <div class="event-type">${e.type}</div>
      <div style="color: var(--text-dim); font-size: 0.8rem">${e.timestamp} — ${e.source_agent}</div>
      <div class="event-payload">${JSON.stringify(e.payload, null, 2)}</div>
    </li>`).join('')}
  </ul>`;
}

// --- Stats ---
async function loadStats() {
  const resp = await fetchApi('/stats');
  if (resp.status !== 'ok') return;
  _statsData = resp.data;
  renderStats();
}

function renderStats() {
  if (!_statsData) return;
  const d = _statsData;

  // --- Bar chart: strategy ranking ---
  const rankingCanvas = document.getElementById('chart-ranking');
  if (rankingCanvas) {
    if (_chartRanking) _chartRanking.destroy();
    const labels = (d.strategy_ranking || []).map(s => s.strategy_name);
    const values = (d.strategy_ranking || []).map(s => +(s.success_rate * 100).toFixed(1));
    _chartRanking = new Chart(rankingCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: t('chart_success_rate'),
          data: values,
          backgroundColor: 'rgba(0,212,170,0.7)',
          borderColor: '#00d4aa',
          borderWidth: 1,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e0e0e0' } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: '#0f3460' } },
          y: { min: 0, max: 100, ticks: { color: '#888' }, grid: { color: '#0f3460' } },
        },
      },
    });
  }

  // --- Doughnut chart: confidence distribution ---
  const confCanvas = document.getElementById('chart-confidence');
  if (confCanvas) {
    if (_chartConfidence) _chartConfidence.destroy();
    const dist = d.confidence_distribution || { high: 0, medium: 0, low: 0 };
    _chartConfidence = new Chart(confCanvas, {
      type: 'doughnut',
      data: {
        labels: [t('chart_high'), t('chart_medium'), t('chart_low')],
        datasets: [{
          data: [dist.high, dist.medium, dist.low],
          backgroundColor: ['#00d4aa', '#ffdd57', '#ff6b6b'],
          borderColor: '#16213e',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e0e0e0' } } },
      },
    });
  }

  // --- Strategy leaderboard table ---
  const leaderboardEl = document.getElementById('stats-leaderboard');
  if (leaderboardEl) {
    const rows = (d.strategy_ranking || []);
    if (rows.length === 0) {
      leaderboardEl.innerHTML = `<p>${t('no_data')}</p>`;
    } else {
      leaderboardEl.innerHTML = `<table class="table">
        <thead><tr><th>${t('strategy')}</th><th>${t('ref_count')}</th><th>${t('success_rate')}</th><th>${t('avg_confidence')}</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td>${r.strategy_name}</td>
            <td>${r.ref_count}</td>
            <td>${(r.success_rate * 100).toFixed(1)}%</td>
            <td>${(r.avg_confidence * 100).toFixed(1)}%</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }
  }

  // --- At-risk list ---
  const atRiskEl = document.getElementById('stats-at-risk');
  if (atRiskEl) {
    const risks = d.at_risk || [];
    if (risks.length === 0) {
      atRiskEl.innerHTML = `<p>${t('no_at_risk')}</p>`;
    } else {
      atRiskEl.innerHTML = `<table class="table">
        <thead><tr><th>${t('id')}</th><th>${t('signals')}</th><th>${t('strategy')}</th><th>${t('confidence')}</th><th>${t('risk_reason')}</th></tr></thead>
        <tbody>
          ${risks.map(r => `<tr class="at-risk">
            <td>${r.exp_id}</td>
            <td>${(r.signals || []).join(', ')}</td>
            <td>${r.strategy_name}</td>
            <td>${(r.confidence * 100).toFixed(1)}%</td>
            <td>${r.risk_reason}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    }
  }

  // --- Agent contributions ---
  const agentsEl = document.getElementById('stats-agents');
  if (agentsEl) {
    const agents = d.agent_contribution || [];
    if (agents.length === 0) {
      agentsEl.innerHTML = `<p>${t('no_data')}</p>`;
    } else {
      agentsEl.innerHTML = `<table class="table">
        <thead><tr><th>${t('agent')}</th><th>${t('count')}</th></tr></thead>
        <tbody>
          ${agents.map(a => `<tr><td>${a.agent}</td><td>${a.count}</td></tr>`).join('')}
        </tbody>
      </table>`;
    }
  }
}

// --- Language toggle ---
function setLang(lang) {
  _lang = lang;
  localStorage.setItem('hive-lang', lang);
  document.documentElement.lang = lang;
  document.title = t('page_title');
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('lang-toggle').textContent = lang === 'en' ? '中文' : 'EN';
  const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (activeTab === 'overview') renderOverview();
  else if (activeTab === 'experiences') renderExperiences();
  else if (activeTab === 'events') renderEvents();
  else if (activeTab === 'stats') renderStats();
}

// --- Init ---
document.getElementById('lang-toggle').addEventListener('click', () => {
  setLang(_lang === 'en' ? 'zh' : 'en');
});

setLang(_lang);
loadTab('overview');
