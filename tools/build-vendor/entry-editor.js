// The editor of Toollib's pages and nodes (0.17.0): CodeMirror 6 with Markdown, LaTeX and the code languages of snippets.
export { EditorState, EditorSelection, Compartment, Prec, StateField, StateEffect, RangeSetBuilder, Transaction, Annotation } from '@codemirror/state';
export { EditorView, keymap, drawSelection, highlightActiveLine, placeholder, ViewPlugin, Decoration, WidgetType, MatchDecorator, dropCursor, highlightSpecialChars, rectangularSelection, crosshairCursor, lineNumbers } from '@codemirror/view';
export { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, indentMore, indentLess, insertNewlineAndIndent, selectAll, cursorDocEnd } from '@codemirror/commands';
export { syntaxHighlighting, HighlightStyle, syntaxTree, indentUnit, bracketMatching, StreamLanguage, LanguageDescription, LanguageSupport, foldGutter, codeFolding, ensureSyntaxTree } from '@codemirror/language';
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap, snippet, snippetCompletion, startCompletion, closeCompletion, acceptCompletion, completionStatus, currentCompletions, selectedCompletion, nextSnippetField, prevSnippetField, hasNextSnippetField, clearSnippet, insertCompletionText, pickedCompletion } from '@codemirror/autocomplete';
export { searchKeymap, highlightSelectionMatches, openSearchPanel, search } from '@codemirror/search';
export { markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown';
export { python } from '@codemirror/lang-python';
export { javascript } from '@codemirror/lang-javascript';
export { yaml } from '@codemirror/lang-yaml';
export { shell } from '@codemirror/legacy-modes/mode/shell';
export { stex, stexMath } from '@codemirror/legacy-modes/mode/stex';
export { tags } from '@lezer/highlight';
