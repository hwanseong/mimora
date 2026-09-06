import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownRenderer({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  return (
    <div className={`markdown-renderer${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} rel="noreferrer noopener" target="_blank" />
          ),
          img: ({ node: _node, alt }) => (
            <span className="markdown-image-placeholder">
              {alt ? `[이미지: ${alt}]` : '[이미지]'}
            </span>
          ),
          table: ({ node: _node, ...props }) => (
            <div className="markdown-table-scroll">
              <table {...props} />
            </div>
          ),
        }}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
