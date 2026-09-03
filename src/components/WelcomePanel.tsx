import { quickPrompts } from '../quickPrompts';

export function WelcomePanel({
  onSelectPrompt,
}: {
  onSelectPrompt: (promptText: string) => void;
}) {
  return (
    <section className="welcome-panel" aria-label="시작 질문">
      <div className="welcome-copy">
        <h2>무엇을 도와드릴까요?</h2>
        <p>프로젝트, 운영, 리스크와 업무에 대해 질문하세요.</p>
      </div>

      <div className="quick-prompts">
        {quickPrompts.map((prompt) => (
          <button
            className="quick-prompt"
            key={prompt.label}
            onClick={() => {
              onSelectPrompt(prompt.prompt);
            }}
            type="button"
          >
            {prompt.label}
          </button>
        ))}
      </div>
    </section>
  );
}
