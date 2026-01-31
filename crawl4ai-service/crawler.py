"""
Crawl4AI service wrapper.

Provides async crawling with fit_markdown extraction,
boilerplate removal, and content segmentation.
"""

import asyncio
from typing import Optional, Dict, Any, List
from crawl4ai import AsyncWebCrawler, CrawlerRunConfig, CacheMode
from crawl4ai.content_filter_strategy import BM25ContentFilter
from config import settings


class CrawlService:
    """Wrapper for Crawl4AI with managed lifecycle."""

    def __init__(self):
        self.crawler: Optional[AsyncWebCrawler] = None
        self._lock = asyncio.Lock()

    async def init(self):
        """Initialize the crawler (call once at startup)."""
        async with self._lock:
            if self.crawler is None:
                self.crawler = AsyncWebCrawler(
                    browser_type=settings.browser_type,
                    headless=settings.headless,
                    verbose=False
                )
                await self.crawler.start()

    async def close(self):
        """Cleanup crawler resources."""
        async with self._lock:
            if self.crawler:
                await self.crawler.close()
                self.crawler = None

    async def ensure_initialized(self):
        """Ensure crawler is initialized."""
        if self.crawler is None:
            await self.init()

    async def crawl(
        self,
        url: str,
        query: Optional[str] = None,
        use_stealth: bool = False,
        cache_mode: str = "enabled"
    ) -> Dict[str, Any]:
        """
        Crawl a URL and return fit_markdown + structured content.

        Args:
            url: Target URL to crawl
            query: Optional BM25 query for focused extraction
            use_stealth: Enable stealth mode for anti-bot sites
            cache_mode: Cache behavior (enabled, disabled, read_only, write_only, bypass)

        Returns:
            Dict with url, title, description, fit_markdown, raw_markdown,
            cleaned_html, links, media, and metadata

        Raises:
            Exception: If crawl fails
        """
        await self.ensure_initialized()

        # Map string cache mode to enum
        cache_mode_map = {
            "enabled": CacheMode.ENABLED,
            "disabled": CacheMode.DISABLED,
            "read_only": CacheMode.READ_ONLY,
            "write_only": CacheMode.WRITE_ONLY,
            "bypass": CacheMode.BYPASS
        }
        cache_enum = cache_mode_map.get(cache_mode.lower(), CacheMode.ENABLED)

        # Build crawler config
        config = CrawlerRunConfig(
            # Content filtering
            word_count_threshold=settings.min_word_threshold,
            excluded_tags=settings.exclude_tags,
            remove_forms=True,

            # Cache
            cache_mode=cache_enum,

            # Timeouts
            page_timeout=settings.timeout,

            # Anti-bot features (if stealth mode enabled)
            simulate_user=use_stealth,
            magic=use_stealth,  # Enables comprehensive stealth features
        )

        # Add BM25 filter if query provided
        if query:
            config.content_filter = BM25ContentFilter(
                user_query=query,
                bm25_threshold=1.0
            )

        # Run the crawl
        result = await self.crawler.arun(url=url, config=config)

        if not result.success:
            raise Exception(f"Crawl failed: {result.error_message}")

        # Extract metadata safely
        metadata = result.metadata if hasattr(result, 'metadata') and result.metadata else {}

        # Extract links safely
        links = {"internal": [], "external": []}
        if hasattr(result, 'links') and result.links:
            links = {
                "internal": result.links.get("internal", []) if isinstance(result.links, dict) else [],
                "external": result.links.get("external", []) if isinstance(result.links, dict) else []
            }

        # Extract media safely
        media = {"images": [], "videos": []}
        if hasattr(result, 'media') and result.media:
            media = {
                "images": result.media.get("images", []) if isinstance(result.media, dict) else [],
                "videos": result.media.get("videos", []) if isinstance(result.media, dict) else []
            }

        return {
            "url": url,
            "title": metadata.get("title", "") if metadata else "",
            "description": metadata.get("description", "") if metadata else "",
            "fit_markdown": result.fit_markdown or result.markdown or "",
            "raw_markdown": result.markdown or "",
            "cleaned_html": result.cleaned_html or "",
            "links": links,
            "media": media,
            "metadata": metadata or {}
        }


# Singleton instance
crawl_service = CrawlService()
