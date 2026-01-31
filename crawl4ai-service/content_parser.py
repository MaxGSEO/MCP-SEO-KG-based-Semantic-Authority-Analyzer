"""
Content parser for converting markdown to structured blocks.

Parses fit_markdown into hierarchical blocks with heading paths,
character positions, and word counts for provenance tracking.
"""

import re
from typing import Optional, List
from pydantic import BaseModel


class ContentBlock(BaseModel):
    """A structured content block with hierarchy information."""

    id: str                           # Unique block ID (e.g., "h2_3", "p_5")
    type: str                         # h1, h2, h3, h4, h5, h6, paragraph, list, table
    text: str                         # Block content
    heading_path: List[str]           # Hierarchy path, e.g. ["H2:Technical SEO", "H3:Core Web Vitals"]
    position: int                     # Order in document (0-indexed)
    char_start: int                   # Start position in original text
    char_end: int                     # End position in original text
    word_count: int                   # Word count in this block
    parent_id: Optional[str] = None   # Parent block ID (heading this is under)


class ContentParser:
    """Parse markdown into structured blocks with heading hierarchy."""

    # Heading patterns for markdown
    HEADING_PATTERN = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

    # List patterns
    LIST_PATTERN = re.compile(r'^[\s]*[-*+]\s+.+$', re.MULTILINE)
    ORDERED_LIST_PATTERN = re.compile(r'^[\s]*\d+\.\s+.+$', re.MULTILINE)

    def parse(self, markdown: str) -> List[ContentBlock]:
        """
        Parse markdown into structured blocks.

        Args:
            markdown: The markdown text to parse

        Returns:
            List of ContentBlock with heading hierarchy preserved
        """
        if not markdown or not markdown.strip():
            return []

        blocks: List[ContentBlock] = []
        heading_stack: List[tuple] = []  # (level, text, id)

        position = 0
        char_pos = 0

        # Split into lines for processing
        lines = markdown.split('\n')
        current_paragraph: List[str] = []
        para_start = 0

        for line in lines:
            line_start = char_pos
            char_pos += len(line) + 1  # +1 for newline

            # Check for heading
            heading_match = self.HEADING_PATTERN.match(line)

            if heading_match:
                # Flush any pending paragraph
                if current_paragraph:
                    para_text = '\n'.join(current_paragraph)
                    if para_text.strip():
                        blocks.append(self._create_paragraph_block(
                            current_paragraph, heading_stack, position, para_start
                        ))
                        position += 1
                    current_paragraph = []

                level = len(heading_match.group(1))
                text = heading_match.group(2).strip()
                block_id = f"h{level}_{position}"

                # Update heading stack - pop any headings of same or deeper level
                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()
                heading_stack.append((level, text, block_id))

                # Create heading block
                # heading_path is the path to this heading (excluding itself)
                heading_path = [f"H{h[0]}:{h[1]}" for h in heading_stack[:-1]]

                blocks.append(ContentBlock(
                    id=block_id,
                    type=f"h{level}",
                    text=text,
                    heading_path=heading_path,
                    position=position,
                    char_start=line_start,
                    char_end=char_pos - 1,
                    word_count=len(text.split()),
                    parent_id=heading_stack[-2][2] if len(heading_stack) > 1 else None
                ))
                position += 1

            elif line.strip():
                # Non-empty line - add to current paragraph
                if not current_paragraph:
                    para_start = line_start
                current_paragraph.append(line)

            else:
                # Empty line - flush paragraph
                if current_paragraph:
                    para_text = '\n'.join(current_paragraph)
                    if para_text.strip():
                        blocks.append(self._create_paragraph_block(
                            current_paragraph, heading_stack, position, para_start
                        ))
                        position += 1
                    current_paragraph = []

        # Flush final paragraph
        if current_paragraph:
            para_text = '\n'.join(current_paragraph)
            if para_text.strip():
                blocks.append(self._create_paragraph_block(
                    current_paragraph, heading_stack, position, para_start
                ))

        return blocks

    def _create_paragraph_block(
        self,
        lines: List[str],
        heading_stack: List[tuple],
        position: int,
        char_start: int
    ) -> ContentBlock:
        """Create a paragraph block from accumulated lines."""
        text = '\n'.join(lines)
        heading_path = [f"H{h[0]}:{h[1]}" for h in heading_stack]

        # Determine block type
        block_type = "paragraph"
        if self.LIST_PATTERN.match(text.strip()) or self.ORDERED_LIST_PATTERN.match(text.strip()):
            block_type = "list"

        return ContentBlock(
            id=f"p_{position}",
            type=block_type,
            text=text,
            heading_path=heading_path,
            position=position,
            char_start=char_start,
            char_end=char_start + len(text),
            word_count=len(text.split()),
            parent_id=heading_stack[-1][2] if heading_stack else None
        )

    def get_sections(self, blocks: List[ContentBlock]) -> dict:
        """
        Group blocks by their top-level heading.

        Returns:
            Dict mapping section name to list of blocks
        """
        sections = {}
        current_section = "Introduction"

        for block in blocks:
            if block.type in ("h1", "h2"):
                current_section = block.text

            if current_section not in sections:
                sections[current_section] = []
            sections[current_section].append(block)

        return sections


# Singleton instance
content_parser = ContentParser()
