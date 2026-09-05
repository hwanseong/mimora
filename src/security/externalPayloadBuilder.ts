export type ExternalPayloadTextDocument = {
  documentId: string;
  maskedContent: string;
};

export type BuiltExternalPayload = {
  text: string;
  documents: ExternalPayloadTextDocument[];
};

export function buildExternalPayloadText(input: {
  maskedQuestion: string;
  maskedDocumentContents: string[];
}): BuiltExternalPayload {
  const documents = input.maskedDocumentContents.map(
    (maskedContent, index) => ({
      documentId: `DOCUMENT_${index + 1}`,
      maskedContent,
    }),
  );
  const contextText = documents
    .map(
      (document) =>
        `[${document.documentId}]\n${document.maskedContent}\n[/${document.documentId}]`,
    )
    .join('\n\n');

  return {
    documents,
    text: `<Project Context>\n${
      contextText || 'No project context was provided.'
    }\n</Project Context>\n\n<User Question>\n${
      input.maskedQuestion
    }\n</User Question>`,
  };
}
