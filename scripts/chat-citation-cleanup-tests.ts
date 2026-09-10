import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { removeInternalContextIdentifiers } from '../src/chatCitationCleanup';
import { SourcesList } from '../src/components/SourcesList';

const cleaned = removeInternalContextIdentifiers(`외부기관 일정 지연의 교훈은 사전 승인 일정을 별도 관리해야 한다는 점입니다.

참고: [CONTEXT DOCUMENT 1], [CONTEXT DOCUMENT 2]

[CONTEXT DOCUMENT 7] 추가로 변경심의 리드타임을 확보해야 합니다.`);

assert.doesNotMatch(cleaned, /\[\/?\s*CONTEXT\s+DOCUMENT\s+\d+\s*\]/iu);
assert.doesNotMatch(cleaned, /^참고\s*:\s*$/imu);
assert.match(cleaned, /외부기관 일정 지연/u);
assert.match(cleaned, /추가로 변경심의/u);

const renderedAnswer = removeInternalContextIdentifiers(
  '취업규칙상 휴게시간은 근무시간 중 부여됩니다. 참고: [CONTEXT DOCUMENT 1]',
);
const sourcesHtml = renderToStaticMarkup(
  createElement(SourcesList, {
    sources: [
      {
        sourceType: 'rag',
        vaultId: 'rag-library',
        vaultName: 'RAG Library',
        vaultType: 'knowledge',
        security: 'sensitive',
        documentSecurity: 'internal',
        relativePath: 'rag://RAG-2026-0007/chunk-8',
        fileName: '취업규칙.pdf',
        ragDocumentId: 'RAG-2026-0007',
        page: 7,
        heading: '휴게시간',
      },
    ],
  }),
);

assert.doesNotMatch(renderedAnswer, /\[CONTEXT DOCUMENT \d+\]/iu);
assert.doesNotMatch(renderedAnswer, /참고\s*:/u);
assert.match(sourcesHtml, /취업규칙\.pdf/u);
assert.match(sourcesHtml, /RAG-2026-0007/u);
assert.match(sourcesHtml, /p\.7/u);

const noSourceAnswer = removeInternalContextIdentifiers(
  '양자컴퓨터 오류보정은 중복 인코딩과 syndrome 측정을 사용합니다.',
);
assert.equal(
  noSourceAnswer,
  '양자컴퓨터 오류보정은 중복 인코딩과 syndrome 측정을 사용합니다.',
);

console.log('chat-citation-cleanup-tests passed');
