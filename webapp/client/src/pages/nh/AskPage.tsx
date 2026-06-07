/**
 * Ask — whole-corpus RAG chat. Chats across everything in the research index
 * (NotebookLM artifacts + collections + free-form uploads) with no scope
 * filter. Citations open the underlying artifact in the inline Viewer.
 */
import CorpusChat from '../../components/CorpusChat';
import { Icon } from '../../components/Icon';

export default function AskPage() {
  return (
    <div className="content">
      <div className="view-head">
        <div className="head-row">
          <div>
            <div className="view-eyebrow">
              <span className="pip" style={{ background: 'var(--accent)' }} />
              Ask
            </div>
            <div className="view-title">
              <span className="t-ic" style={{ width: 42, height: 42 }}>
                <Icon id="i-chat" />
              </span>
              <h1>Ask your corpus</h1>
            </div>
            <p className="view-sub">
              One question, answered across every source you've collected — notebooks,
              collections, and free-form uploads — with citations back to each document.
            </p>
          </div>
        </div>
      </div>

      <CorpusChat
        scope={{}}
        title="Ask your whole corpus"
        subtitle="Answers draw on everything in your research index, with citations."
        placeholder="Ask anything across your sources…"
        suggestions={[
          'What themes recur across my sources?',
          'Summarize what I’ve collected on this topic',
          'What contradictions exist between my sources?',
        ]}
      />
    </div>
  );
}
