import { quickPrompts } from '../quickPrompts';

export function QuickPromptBar({
  onSelectPrompt,
}: {
  onSelectPrompt: (promptText: string) => void;
}) {
  return (
    <div className="quick-prompt-bar" aria-label="빠른 질문">
      {quickPrompts.map((prompt) => (
        <button
          className="quick-prompt-chip"
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
  );
}
