"""
Configuration settings for Crawl4AI microservice.
"""

from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Server configuration
    host: str = "0.0.0.0"
    port: int = 8000

    # Crawl4AI browser settings
    browser_type: str = "chromium"  # chromium, firefox, webkit
    headless: bool = True
    timeout: int = 30000  # milliseconds

    # Rate limiting
    delay_min: float = 1.0  # minimum delay between requests (seconds)
    delay_max: float = 3.0  # maximum delay between requests (seconds)
    max_retries: int = 3

    # Content filtering
    min_word_threshold: int = 10  # minimum words per block
    exclude_tags: List[str] = [
        "nav", "footer", "header", "aside",
        "script", "style", "noscript", "iframe"
    ]

    # Cache settings
    cache_enabled: bool = True
    cache_ttl: int = 3600  # seconds

    class Config:
        env_prefix = "CRAWL4AI_"
        env_file = ".env"


settings = Settings()
