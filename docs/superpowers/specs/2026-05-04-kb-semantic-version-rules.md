# Knowledge Base Semantic Version Rules

Knowledge base versions use semantic version format: `v0.0.0`.

## Version Meaning

- `v0.x.x`: draft or pre-production KB versions.
- `v1.0.0`: first published production-ready KB version.
- Patch version: file correction, typo fix, metadata correction, or small content fix.
- Minor version: add or remove files, update sources, or change chunking strategy.
- Major version: change KB scope, retrieval mode, or the core purpose of the KB.

## Examples

- `v0.1.0`: first draft.
- `v0.2.0`: added more files.
- `v0.2.1`: fixed one uploaded file.
- `v1.0.0`: first published production version.
- `v1.1.0`: added new policy documents.
- `v2.0.0`: changed from file KB to vector-indexed KB, or changed agent/domain scope.

## UI Rules

The UI should show both draft and published state where applicable:

- `Draft v0.2.0`
- `Published v1.0.0`

Agent assignments should support:

- `latest published`
- pinned version, such as `v1.0.0`

Agents must never use draft versions. A draft only becomes usable by agents after the user explicitly publishes it.


## Common node parsers

LlamaIndex has different node parsers for different use cases:

Parser	Use case
SentenceSplitter	Split text while respecting sentence boundaries
TokenTextSplitter	Split text by token count
MarkdownNodeParser	Parse Markdown documents
JSONNodeParser	Parse JSON
HTMLNodeParser	Parse HTML
CodeSplitter	Split source code
SemanticSplitterNodeParser	Split based on semantic similarity
HierarchicalNodeParser	Create parent-child chunk structures