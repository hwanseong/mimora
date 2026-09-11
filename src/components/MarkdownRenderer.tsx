import {
  Children,
  isValidElement,
  type MouseEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const documentIdLinkPattern = /^DOC-\d{4}-\d{4}$/u;

function getTextContent(children: ReactNode): string | null {
  const textParts: string[] = [];

  function visit(child: ReactNode): boolean {
    if (child === null || child === undefined || typeof child === 'boolean') {
      return true;
    }

    if (typeof child === 'string' || typeof child === 'number') {
      textParts.push(String(child));
      return true;
    }

    if (Array.isArray(child)) {
      return child.every(visit);
    }

    if (isValidElement<{ children?: ReactNode }>(child)) {
      return visit(child.props.children);
    }

    return false;
  }

  const canExtractText = Children.toArray(children).every(visit);

  return canExtractText && textParts.length > 0 ? textParts.join('') : null;
}

export function MarkdownRenderer({
  content,
  className = '',
}: {
  content: string;
  className?: string;
}) {
  function handleLinkClick(
    event: MouseEvent<HTMLAnchorElement>,
    href: string | undefined,
  ): void {
    event.preventDefault();

    if (!href) {
      return;
    }

    void window.mimora.openExternalLink(href).catch((error: unknown) => {
      console.warn(
        error instanceof Error
          ? error.message
          : 'External link could not be opened.',
      );
    });
  }

  return (
    <div className={`markdown-renderer${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        components={{
          a: ({ node: _node, children, ...props }) => {
            const textContent = getTextContent(children)?.trim();

            if (textContent && documentIdLinkPattern.test(textContent)) {
              return (
                <span className="document-id-inline-badge">
                  {textContent}
                </span>
              );
            }

            return (
              <a
                {...props}
                onClick={(event) => handleLinkClick(event, props.href)}
                rel="noreferrer noopener"
              >
                {children}
              </a>
            );
          },
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
