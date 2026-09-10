const contextDocumentIdentifierPattern =
  /\[\/?\s*CONTEXT\s+DOCUMENT\s+\d+\s*\]/giu;

const contextDocumentReferenceLinePattern =
  /^[ \t]*(?:참고|출처|근거|source|sources|reference|references)\s*:\s*(?:\[\/?\s*CONTEXT\s+DOCUMENT\s+\d+\s*\][\s,;]*)+[ \t]*$/gimu;

const contextDocumentCitationPattern =
  /[ \t]*(?:참고|출처|근거|source|sources|reference|references)\s*:\s*(?:\[\/?\s*CONTEXT\s+DOCUMENT\s+\d+\s*\][\s,;]*)+/giu;

export function removeInternalContextIdentifiers(content: string): string {
  return content
    .replace(contextDocumentReferenceLinePattern, '')
    .replace(contextDocumentCitationPattern, '')
    .replace(contextDocumentIdentifierPattern, '')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/[ \t]+([,.;:!?])/gu, '$1')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}
