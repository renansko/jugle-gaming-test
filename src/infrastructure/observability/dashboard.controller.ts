import { Controller, Get, Res } from "@nestjs/common";

/** @wiki docs/brain/conventions/Observability.md */
@Controller("dashboard")
export class DashboardController {
  @Get()
  public getDashboard(
    @Res() response: { setHeader(k: string, v: string): void; send(body: string): void },
  ): void {
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.send(this.renderDashboardHtml());
  }

  private renderDashboardHtml(): string {
    return `<!DOCTYPE html>
<html lang="pt-BR" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jungle Gaming — Wagering Observability & Health Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0a0d14;
      --bg-surface: rgba(18, 24, 38, 0.75);
      --bg-surface-hover: rgba(26, 35, 54, 0.85);
      --border-color: rgba(255, 255, 255, 0.08);
      --border-highlight: rgba(99, 102, 241, 0.3);
      --text-primary: #f8fafc;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent-primary: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.15);
      --warning: #f59e0b;
      --danger: #ef4444;
      --danger-glow: rgba(239, 68, 68, 0.15);
      --info: #38bdf8;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: radial-gradient(circle at 50% 0%, #171e31 0%, var(--bg-primary) 70%);
      color: var(--text-primary);
      min-height: 100vh;
      padding: 24px;
      line-height: 1.5;
    }

    .container {
      max-width: 1380px;
      margin: 0 auto;
    }

    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 28px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      backdrop-filter: blur(12px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .brand-logo {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #4f46e5, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      font-weight: 800;
      color: white;
      box-shadow: 0 0 20px rgba(79, 70, 229, 0.4);
    }
    .brand-title h1 {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .brand-title p {
      font-size: 13px;
      color: var(--text-secondary);
    }

    .controls {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      color: var(--text-primary);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn:hover {
      background: var(--bg-surface-hover);
      border-color: var(--border-highlight);
    }
    .btn-primary {
      background: linear-gradient(135deg, #6366f1, #4f46e5);
      border: none;
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.3);
    }
    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    /* System Health Ribbon */
    .health-ribbon {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .health-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 18px 20px;
      backdrop-filter: blur(16px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      transition: all 0.2s ease;
    }
    .health-card:hover {
      border-color: var(--border-highlight);
      transform: translateY(-2px);
    }
    .health-info h4 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .health-info .status-text {
      font-size: 18px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 700;
    }
    .badge-healthy {
      background: var(--success-glow);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-degraded {
      background: var(--danger-glow);
      color: var(--danger);
      border: 1px solid rgba(239, 68, 68, 0.3);
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.8); }
      100% { opacity: 1; transform: scale(1); }
    }

    /* KPI Metrics Grid */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .kpi-card {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 14px;
      padding: 20px;
      backdrop-filter: blur(16px);
      position: relative;
      overflow: hidden;
    }
    .kpi-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: linear-gradient(90deg, #6366f1, #06b6d4);
      opacity: 0.6;
    }
    .kpi-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .kpi-value {
      font-size: 28px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-primary);
    }
    .kpi-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    /* Main Panels */
    .dashboard-grid {
      display: grid;
      grid-template-columns: 2fr 1.2fr;
      gap: 20px;
      margin-bottom: 24px;
    }
    @media (max-width: 1024px) {
      .dashboard-grid { grid-template-columns: 1fr; }
    }
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      padding: 24px;
      backdrop-filter: blur(16px);
    }
    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .panel-title {
      font-size: 16px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    /* Breakdown Bars */
    .breakdown-list {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .breakdown-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .breakdown-meta {
      display: flex;
      justify-content: space-between;
      font-size: 13px;
    }
    .breakdown-label {
      font-weight: 600;
    }
    .breakdown-count {
      font-family: 'JetBrains Mono', monospace;
      color: var(--text-secondary);
    }
    .progress-bar-bg {
      height: 8px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 4px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 4px;
      transition: width 0.4s ease;
    }

    /* Latency & Metrics Table */
    .metrics-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    .metrics-table th, .metrics-table td {
      padding: 10px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }
    .metrics-table th {
      color: var(--text-secondary);
      font-weight: 600;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .metrics-table td.val {
      font-family: 'JetBrains Mono', monospace;
      font-weight: 600;
    }

    /* OpenTelemetry Raw Export */
    .raw-metrics {
      background: rgba(10, 13, 20, 0.85);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #38bdf8;
      max-height: 240px;
      overflow-y: auto;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="brand-logo">⚡</div>
        <div class="brand-title">
          <h1>Jungle Gaming — Wagering Observability</h1>
          <p>OpenTelemetry Instruments, Prometheus Metrics & Real-time Health Checks</p>
        </div>
      </div>
      <div class="controls">
        <span id="lastUpdated" style="font-size: 12px; color: var(--text-muted);">Atualizando...</span>
        <button class="btn" onclick="fetchData()">🔄 Atualizar</button>
        <a class="btn btn-primary" href="/metrics" target="_blank">📊 Prometheus /metrics</a>
        <a class="btn" href="http://localhost:8080" target="_blank">📬 SQS Admin UI</a>
      </div>
    </header>

    <!-- Health Checks -->
    <div class="health-ribbon">
      <div class="health-card">
        <div class="health-info">
          <h4>Aplicação (Liveness)</h4>
          <div class="status-text" id="liveStatus">
            <span class="status-badge badge-healthy"><span class="pulse-dot"></span> LIVE</span>
          </div>
        </div>
        <div style="font-size: 24px;">🟢</div>
      </div>

      <div class="health-card">
        <div class="health-info">
          <h4>Prontidão & Dependências (Readiness)</h4>
          <div class="status-text" id="readyStatus">
            <span class="status-badge badge-healthy"><span class="pulse-dot"></span> READY</span>
          </div>
        </div>
        <div style="font-size: 24px;">🛡️</div>
      </div>

      <div class="health-card">
        <div class="health-info">
          <h4>PostgreSQL 16</h4>
          <div class="status-text" id="pgStatus">
            <span class="status-badge badge-healthy">HEALTHY</span>
          </div>
        </div>
        <div style="font-size: 24px;">🐘</div>
      </div>

      <div class="health-card">
        <div class="health-info">
          <h4>LocalStack SQS FIFO</h4>
          <div class="status-text" id="sqsStatus">
            <span class="status-badge badge-healthy">CONNECTED</span>
          </div>
        </div>
        <div style="font-size: 24px;">📦</div>
      </div>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Total de Apostas</div>
        <div class="kpi-value" id="kpiTotalWagers">0</div>
        <div class="kpi-sub">Transações registradas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Replays Idempotentes</div>
        <div class="kpi-value" id="kpiIdempotentReplays">0</div>
        <div class="kpi-sub">Execuções duplicadas salvas</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Latência Média</div>
        <div class="kpi-value" id="kpiLatency">0 ms</div>
        <div class="kpi-sub">wager_processing_latency_ms</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Lock de Carteira</div>
        <div class="kpi-value" id="kpiLockDuration">0 ms</div>
        <div class="kpi-sub">PESSIMISTIC_WRITE duration</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Outbox Pendente</div>
        <div class="kpi-value" id="kpiOutboxPending">0</div>
        <div class="kpi-sub">Eventos na fila de publicação</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Divergências de Saldo</div>
        <div class="kpi-value" id="kpiDivergences" style="color: var(--success);">0</div>
        <div class="kpi-sub">Reconciliação matemática 100%</div>
      </div>
    </div>

    <!-- Main Dashboard Grid -->
    <div class="dashboard-grid">
      <!-- Breakdown Panel -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">🎰 Distribuição de Operações Financeiras</div>
        </div>
        <div class="breakdown-list" id="operationsBreakdown">
          <!-- Populated by JavaScript -->
        </div>
      </div>

      <!-- Latency & Messaging Panel -->
      <div class="panel">
        <div class="panel-header">
          <div class="panel-title">⏱️ Métricas de Latência & Mensageria</div>
        </div>
        <table class="metrics-table">
          <thead>
            <tr>
              <th>Instrumento OpenTelemetry</th>
              <th>Valor Observado</th>
            </tr>
          </thead>
          <tbody id="metricsTableBody">
            <!-- Populated by JavaScript -->
          </tbody>
        </table>
      </div>
    </div>

    <!-- Raw Prometheus Export -->
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">📡 OpenTelemetry / Prometheus Raw Stream</div>
      </div>
      <div class="raw-metrics" id="rawPrometheus">Carregando métricas OpenTelemetry...</div>
    </div>
  </div>

  <script>
    async function fetchData() {
      try {
        // Fetch Metrics (JSON)
        const metricsRes = await fetch('/metrics', { headers: { 'accept': 'application/json' } });
        const metricsData = await metricsRes.json();

        // Fetch Raw Prometheus
        const rawRes = await fetch('/metrics', { headers: { 'accept': 'text/plain' } });
        const rawText = await rawRes.text();
        document.getElementById('rawPrometheus').innerText = rawText;

        // Fetch Readiness
        const readyRes = await fetch('/health/ready');
        const readyData = await readyRes.json();

        updateHealth(readyData);
        updateKPIs(metricsData);
        updateBreakdown(metricsData);
        updateMetricsTable(metricsData);

        document.getElementById('lastUpdated').innerText = 'Última atualização: ' + new Date().toLocaleTimeString();
      } catch (err) {
        console.error('Erro ao buscar métricas:', err);
      }
    }

    function updateHealth(readyData) {
      const isReady = readyData.status === 'ok';
      const readyBadge = document.getElementById('readyStatus');
      readyBadge.innerHTML = isReady
        ? '<span class="status-badge badge-healthy"><span class="pulse-dot"></span> READY</span>'
        : '<span class="status-badge badge-degraded">UNHEALTHY</span>';

      const pgBadge = document.getElementById('pgStatus');
      const pgOk = readyData.dependencies && readyData.dependencies.postgres === 'healthy';
      pgBadge.innerHTML = pgOk
        ? '<span class="status-badge badge-healthy">HEALTHY</span>'
        : '<span class="status-badge badge-degraded">UNHEALTHY</span>';

      const sqsBadge = document.getElementById('sqsStatus');
      const sqsOk = readyData.dependencies && readyData.dependencies.sqs === 'healthy';
      sqsBadge.innerHTML = sqsOk
        ? '<span class="status-badge badge-healthy">CONNECTED</span>'
        : '<span class="status-badge badge-degraded">DISCONNECTED</span>';
    }

    function updateKPIs(metrics) {
      let totalWagers = 0;
      let totalReplays = 0;
      let divergences = 0;
      let lockMs = 0;
      let latencyMs = 0;
      let outboxPending = 0;

      for (const [key, val] of Object.entries(metrics)) {
        if (key.startsWith('wager_transactions_total')) totalWagers += val;
        if (key.startsWith('idempotency_replays_total')) totalReplays += val;
        if (key.startsWith('reconciliation_divergences_total')) divergences += val;
        if (key.startsWith('wallet_lock_duration_ms')) lockMs = val;
        if (key.startsWith('wager_processing_latency_ms')) latencyMs = val;
        if (key.startsWith('outbox_pending')) outboxPending = val;
      }

      document.getElementById('kpiTotalWagers').innerText = totalWagers;
      document.getElementById('kpiIdempotentReplays').innerText = totalReplays;
      document.getElementById('kpiLatency').innerText = latencyMs + ' ms';
      document.getElementById('kpiLockDuration').innerText = lockMs + ' ms';
      document.getElementById('kpiOutboxPending').innerText = outboxPending;

      const divEl = document.getElementById('kpiDivergences');
      divEl.innerText = divergences;
      divEl.style.color = divergences === 0 ? 'var(--success)' : 'var(--danger)';
    }

    function updateBreakdown(metrics) {
      const kinds = {
        'BET': { color: '#6366f1', count: 0 },
        'WIN': { color: '#10b981', count: 0 },
        'LOSS': { color: '#f59e0b', count: 0 },
        'REFUND': { color: '#38bdf8', count: 0 },
        'ROLLBACK': { color: '#ec4899', count: 0 }
      };

      let total = 0;
      for (const [key, val] of Object.entries(metrics)) {
        if (key.startsWith('wager_transactions_total')) {
          for (const kind of Object.keys(kinds)) {
            if (key.includes('kind=' + kind)) {
              kinds[kind].count += val;
              total += val;
            }
          }
        }
      }

      const container = document.getElementById('operationsBreakdown');
      container.innerHTML = Object.entries(kinds).map(([name, data]) => {
        const pct = total > 0 ? ((data.count / total) * 100).toFixed(1) : 0;
        return \`
          <div class="breakdown-item">
            <div class="breakdown-meta">
              <span class="breakdown-label" style="color: \${data.color};">\${name}</span>
              <span class="breakdown-count">\${data.count} (\${pct}%)</span>
            </div>
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: \${pct}%; background: \${data.color};"></div>
            </div>
          </div>
        \`;
      }).join('');
    }

    function updateMetricsTable(metrics) {
      const tbody = document.getElementById('metricsTableBody');
      tbody.innerHTML = Object.entries(metrics).map(([k, v]) => \`
        <tr>
          <td style="color: var(--text-secondary); font-family: 'JetBrains Mono', monospace; font-size: 11px;">\${k}</td>
          <td class="val">\${v}</td>
        </tr>
      \`).join('');
    }

    // Auto-refresh every 2 seconds
    fetchData();
    setInterval(fetchData, 2000);
  </script>
</body>
</html>`;
  }
}
