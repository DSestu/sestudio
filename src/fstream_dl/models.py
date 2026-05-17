from dataclasses import dataclass, field


@dataclass
class SeasonCard:
    newsid: str
    title: str
    series_name: str
    season_number: int
    poster_url: str
    page_url: str
    is_film: bool = False


@dataclass
class Episode:
    number: int
    title: str
    season: int
    embed_urls: dict[str, str] = field(default_factory=dict)  # provider -> embed url

    @property
    def filename(self) -> str:
        safe_title = self.title.replace("/", "-").replace("\\", "-").strip()
        if self.season == 0:
            return f"{safe_title}.mp4"
        return f"S{self.season:02d}E{self.number:02d} - {safe_title}.mp4"


@dataclass
class StreamSource:
    url: str
    referer: str
    provider: str
