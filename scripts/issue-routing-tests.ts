import assert from 'node:assert/strict';

type TemporalScope = 'CURRENT_OPEN' | 'HISTORICAL_ALL' | 'RESOLVED_ONLY';
type IssueIntent = 'open_issues' | 'owner_bottleneck' | 'organization_support' | 'resolved_cases' | 'issue_lookup';

function containsAny(query: string, tokens: string[]): boolean {
  return tokens.some((token) => query.includes(token));
}

function compact(query: string): string {
  return query.replace(/\s+/gu, '');
}

function hasUnresolvedSignal(query: string): boolean {
  const queryText = query.toLowerCase();
  const compactText = compact(queryText);

  return (
    containsAny(queryText, [
      '미해결',
      '진행 중',
      '진행중',
      '열린 이슈',
      '오픈 이슈',
      '남은 이슈',
      '남아있는 이슈',
      'open',
      'unresolved',
    ]) ||
    containsAny(compactText, [
      '해결안된',
      '해결안된이슈',
      '해결이안된',
      '안끝난',
      '진행중',
      '진행중인',
      '열린이슈',
      '오픈이슈',
      '남은이슈',
      '남아있는이슈',
    ])
  );
}

function hasCompletedHistoryIncludeSignal(query: string): boolean {
  const queryText = query.toLowerCase();
  const compactText = compact(queryText);

  return (
    containsAny(queryText, [
      '완료 이력 포함',
      '완료된 이슈도 포함',
      '완료도 포함',
      'resolved history',
      'include resolved',
      'include completed',
    ]) ||
    (compactText.includes('포함') &&
      containsAny(compactText, ['완료된', '해결된', '완료이력']))
  );
}

function temporalScope(query: string): TemporalScope {
  const queryText = query.toLowerCase();

  if (hasCompletedHistoryIncludeSignal(queryText)) {
    return 'HISTORICAL_ALL';
  }

  if (
    containsAny(queryText, [
      '해결된',
      '완료된',
      '어떻게 해결',
      '조치가 완료',
      '해결 사례',
      'resolved',
      'closed',
      'completed',
    ])
  ) {
    return 'RESOLVED_ONLY';
  }

  if (
    containsAny(queryText, [
      '과거',
      '이력',
      '이력이 있는',
      '필요했던',
      '발생했던',
      '전체',
      '모든',
      'historical',
      'history',
      'all',
    ])
  ) {
    return 'HISTORICAL_ALL';
  }

  if (hasUnresolvedSignal(queryText)) {
    return 'CURRENT_OPEN';
  }

  if (
    containsAny(queryText, [
      '누가',
      '담당',
      '맡',
      'owner',
      'assignee',
      'bottleneck',
      '병목',
    ])
  ) {
    return 'CURRENT_OPEN';
  }

  if (
    containsAny(queryText, ['조직지원', '조직 지원', '조직의 지원', '지원']) &&
    containsAny(queryText, ['필요한', '필요'])
  ) {
    return 'CURRENT_OPEN';
  }

  if (
    containsAny(queryText, [
      '현재',
      '진행 중',
      '진행중',
      '해결이 필요한',
      '위험한 이슈',
      '지연된 이슈',
      '오래 지연',
      '조치가 필요한',
      '조직지원이 필요한',
      '조직지원 필요한',
      '지원이 필요한',
      '지원 필요한',
      '지원 필요',
      '조직의 지원이 필요한',
      'open',
      'current',
      'overdue',
      'late',
    ])
  ) {
    return 'CURRENT_OPEN';
  }

  return 'HISTORICAL_ALL';
}

function issueIntent(query: string): IssueIntent {
  const queryText = query.toLowerCase();

  if (containsAny(queryText, ['누가', '담당', '맡', 'owner', 'assignee', 'bottleneck', '병목'])) {
    return 'owner_bottleneck';
  }

  if (hasCompletedHistoryIncludeSignal(queryText) || hasUnresolvedSignal(queryText)) {
    return 'open_issues';
  }

  if (containsAny(queryText, ['support', '조직지원', '조직 지원', '조직의 지원', '지원'])) {
    return 'organization_support';
  }

  if (temporalScope(queryText) === 'RESOLVED_ONLY') {
    return 'resolved_cases';
  }

  return 'issue_lookup';
}

const cases: Array<[string, TemporalScope]> = [
  ['조직의 지원이 필요한 이슈는?', 'CURRENT_OPEN'],
  ['현재 조직지원이 필요한 이슈는?', 'CURRENT_OPEN'],
  ['조직지원 필요한 건 뭐야?', 'CURRENT_OPEN'],
  ['지원이 필요한 이슈는?', 'CURRENT_OPEN'],
  ['조직지원이 필요했던 이슈는?', 'HISTORICAL_ALL'],
  ['과거 조직지원이 필요했던 이슈는?', 'HISTORICAL_ALL'],
  ['조직지원이 필요했던 사례는?', 'HISTORICAL_ALL'],
  ['조직지원 이력은?', 'HISTORICAL_ALL'],
  ['전체 조직지원 이슈를 보여줘', 'HISTORICAL_ALL'],
  ['해결된 이슈 중 조직지원이 필요했던 것은?', 'RESOLVED_ONLY'],
  ['완료된 조직지원 이슈는?', 'RESOLVED_ONLY'],
  ['해결 완료된 조직지원 사례는?', 'RESOLVED_ONLY'],
  ['현재 해결이 가장 위험한 이슈는?', 'CURRENT_OPEN'],
  ['누가 맡은 이슈가 오래 지연되고 있어?', 'CURRENT_OPEN'],
  ['누가 맡은 이슈가 해결이 안되고 있어?', 'CURRENT_OPEN'],
  ['해결안된이슈는', 'CURRENT_OPEN'],
  ['미해결 이슈 알려줘', 'CURRENT_OPEN'],
  ['진행중인 이슈 뭐야', 'CURRENT_OPEN'],
  ['완료된 이슈도 포함해서 보여줘', 'HISTORICAL_ALL'],
];

for (const [query, expected] of cases) {
  assert.equal(temporalScope(query), expected, query);
}

assert.equal(issueIntent('해결안된이슈는'), 'open_issues');
assert.equal(issueIntent('미해결 이슈 알려줘'), 'open_issues');
assert.equal(issueIntent('진행중인 이슈 뭐야'), 'open_issues');
assert.equal(issueIntent('누가 맡은 이슈가 해결이 안되고 있어?'), 'owner_bottleneck');
assert.equal(issueIntent('완료된 이슈도 포함해서 보여줘'), 'open_issues');

console.log('issue-routing-tests passed');
