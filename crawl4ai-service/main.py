"""
Crawl4AI FastAPI Microservice

Provides HTTP endpoints for web crawling with fit_markdown extraction
and structured content blocks for the SEO Semantic MCP server.
"""

import asyncio
import logging
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl

from crawler import crawl_service
from content_parser import content_parser, ContentBlock
from config import settings

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================
# LIFESPAN MANAGEMENT
# ============================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("Starting Crawl4AI service...")
    try:
        await crawl_service.init()
        logger.info("Crawl4AI service started successfully")
    except Exception as e:
        logger.error(f"Failed to start crawler: {e}")
        raise
    yield
    logger.info("Shutting down Crawl4AI service...")
    await crawl_service.close()
    logger.info("Crawl4AI service stopped")


# ============================================
# FASTAPI APP
# ============================================

app = FastAPI(
    title="Crawl4AI Service",
    description="Web crawling microservice for SEO Semantic MCP",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================
# REQUEST/RESPONSE MODELS
# ============================================

class CrawlRequest(BaseModel):
    """Request model for /crawl endpoint."""
    url: HttpUrl
    query: Optional[str] = None         # BM25 query for focused extraction
    use_stealth: bool = False           # Enable anti-bot stealth mode
    cache_mode: str = "enabled"         # enabled, disabled, read_only, write_only, bypass
    parse_blocks: bool = True           # Return structured blocks


class CrawlResponse(BaseModel):
    """Response model for /crawl endpoint."""
    url: str
    title: str
    description: str
    fit_markdown: str
    raw_markdown: str
    blocks: Optional[List[ContentBlock]] = None
    links: dict
    media: dict
    metadata: dict


class HealthResponse(BaseModel):
    """Response model for /health endpoint."""
    status: str
    version: str


class BatchCrawlRequest(BaseModel):
    """Request model for /batch-crawl endpoint."""
    urls: List[HttpUrl]
    query: Optional[str] = None


class BatchCrawlResult(BaseModel):
    """Result for a single URL in batch crawl."""
    url: str
    success: bool
    fit_markdown: Optional[str] = None
    blocks: Optional[List[dict]] = None
    error: Optional[str] = None


class BatchCrawlResponse(BaseModel):
    """Response model for /batch-crawl endpoint."""
    results: List[BatchCrawlResult]


# ============================================
# ENDPOINTS
# ============================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(status="healthy", version="1.0.0")


@app.post("/crawl", response_model=CrawlResponse)
async def crawl_url(request: CrawlRequest):
    """
    Crawl a URL and return fit_markdown + structured blocks.

    - **url**: Target URL to crawl
    - **query**: Optional BM25 query for focused content extraction
    - **use_stealth**: Enable stealth mode for anti-bot protected sites
    - **cache_mode**: Cache behavior (enabled, disabled, read_only, write_only, bypass)
    - **parse_blocks**: If true, parse markdown into structured blocks
    """
    try:
        logger.info(f"Crawling URL: {request.url}")

        result = await crawl_service.crawl(
            url=str(request.url),
            query=request.query,
            use_stealth=request.use_stealth,
            cache_mode=request.cache_mode
        )

        # Parse into structured blocks if requested
        blocks = None
        if request.parse_blocks and result.get("fit_markdown"):
            blocks = content_parser.parse(result["fit_markdown"])

        logger.info(f"Successfully crawled {request.url}, {len(blocks or [])} blocks extracted")

        return CrawlResponse(
            url=result["url"],
            title=result["title"],
            description=result["description"],
            fit_markdown=result["fit_markdown"],
            raw_markdown=result["raw_markdown"],
            blocks=blocks,
            links=result["links"],
            media=result["media"],
            metadata=result["metadata"]
        )

    except Exception as e:
        logger.error(f"Crawl failed for {request.url}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/batch-crawl", response_model=BatchCrawlResponse)
async def batch_crawl(request: BatchCrawlRequest):
    """
    Crawl multiple URLs with rate limiting.

    - **urls**: List of URLs to crawl
    - **query**: Optional BM25 query for focused extraction
    """
    results: List[BatchCrawlResult] = []

    for url in request.urls:
        try:
            logger.info(f"Batch crawling: {url}")

            result = await crawl_service.crawl(
                url=str(url),
                query=request.query
            )

            blocks = content_parser.parse(result["fit_markdown"])

            results.append(BatchCrawlResult(
                url=str(url),
                success=True,
                fit_markdown=result["fit_markdown"],
                blocks=[b.model_dump() for b in blocks]
            ))

        except Exception as e:
            logger.error(f"Batch crawl failed for {url}: {e}")
            results.append(BatchCrawlResult(
                url=str(url),
                success=False,
                error=str(e)
            ))

        # Rate limiting delay between URLs
        await asyncio.sleep(settings.delay_min)

    return BatchCrawlResponse(results=results)


@app.get("/")
async def root():
    """Root endpoint with service info."""
    return {
        "service": "Crawl4AI Microservice",
        "version": "1.0.0",
        "description": "Web crawling service for SEO Semantic MCP",
        "endpoints": {
            "/health": "Health check",
            "/crawl": "Crawl a single URL (POST)",
            "/batch-crawl": "Crawl multiple URLs (POST)"
        }
    }


# ============================================
# MAIN ENTRY POINT
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info"
    )
