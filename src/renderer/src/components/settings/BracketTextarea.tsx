import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import styles from './BracketTextarea.module.css';

interface BracketTextareaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

const baseTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
  },

  '.cm-scroller': {
    fontFamily: "'SF Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 'var(--font-size-xs)',
    lineHeight: 1.5,
  },

  '.cm-content': {
    caretColor: 'var(--color-text-primary)',
    padding: '8px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    lineHeight: 'inherit',
  },

  '.cm-line': { padding: 0 },

  '.cm-cursor': {
    borderLeftColor: 'var(--color-primary)',
  },

  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--color-primary) 30%, transparent)',
  },

  '.cm-matchingBracket': {
    backgroundColor: 'color-mix(in srgb, var(--color-primary) 55%, transparent)',
    outline: '1px solid color-mix(in srgb, var(--color-primary) 70%, transparent)',
    borderRadius: '2px',
  },

  '.cm-nonmatchingBracket': {
    backgroundColor: 'color-mix(in srgb, #ef4444 30%, transparent)',
    outline: '1px solid color-mix(in srgb, #ef4444 50%, transparent)',
    borderRadius: '2px',
  },

  '.cm-placeholder': {
    color: 'var(--color-text-secondary)',
    fontFamily: 'inherit',
    fontSize: 'inherit',
  },

  '.cm-gutters': { display: 'none' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-foldGutter': { display: 'none' },
});

const syntaxStyle = HighlightStyle.define([
  { tag: tags.string, color: 'var(--cm-string)' },
  { tag: tags.number, color: 'var(--cm-number)' },
  { tag: tags.bool, color: 'var(--cm-keyword)' },
  { tag: tags.null, color: 'var(--cm-keyword)' },
  { tag: tags.propertyName, color: 'var(--cm-property)' },
  { tag: tags.separator, color: 'var(--cm-separator)' },
  { tag: tags.bracket, color: 'var(--cm-bracket)' },
  { tag: tags.keyword, color: 'var(--cm-keyword)' },
  { tag: tags.comment, color: 'var(--cm-comment)' },
  { tag: tags.operator, color: 'var(--cm-operator)' },
]);

export function BracketTextarea({ value, onChange, placeholder, className }: BracketTextareaProps) {
  return (
    <div className={`${styles.container} ${className || ''}`}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[json(), baseTheme, syntaxHighlighting(syntaxStyle)]}
        placeholder={placeholder}
        height="100%"
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          bracketMatching: true,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          highlightSelectionMatches: false,
          syntaxHighlighting: true,
          history: true,
          historyKeymap: true,
          defaultKeymap: true,
        }}
      />
    </div>
  );
}
