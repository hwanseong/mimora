const statusItems = [
  { label: '정상', value: 6, tone: 'stable' },
  { label: '주의', value: 4, tone: 'watch' },
  { label: '위험', value: 3, tone: 'risk' },
];

const alerts = [
  'PJT-A 일정 지연',
  'PJT-B 요구사항 변경 증가',
  'SYS-A 배치 장애 발생',
  'DBA 리소스 충돌 가능성',
];

export function ContextPanel() {
  return (
    <aside className="context-panel" aria-label="업무 현황">
      <h2>업무 현황</h2>

      <div className="status-grid">
        {statusItems.map((item) => (
          <div className={`status-card ${item.tone}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <section className="alerts-section" aria-labelledby="alerts-heading">
        <h3 id="alerts-heading">최근 알림</h3>
        <ul>
          {alerts.map((alert) => (
            <li key={alert}>{alert}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
