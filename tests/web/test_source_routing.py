"""End-to-end tests for source routing: explicit ids, fallbacks, and the
direct-stream site path (a site that resolves candidates without any shared
host resolver)."""

from __future__ import annotations


def test_season_routes_to_explicit_source(fake_site_client):
    resp = fake_site_client.get("/api/season?url=https://fake.example/1&source=fake")
    assert resp.status_code == 200
    data = resp.json()
    assert data["source"] == "fake"
    assert data["episodes"][0]["embed_urls"] == {"direct": "https://fake.example/e1"}


def test_season_falls_back_to_owns_url_without_source(fake_site_client):
    resp = fake_site_client.get("/api/season?url=https://fake.example/1-title.html")
    assert resp.status_code == 200
    assert resp.json()["source"] == "fake"


def test_resolve_uses_site_owned_resolution(fake_site_client):
    resp = fake_site_client.post(
        "/api/stream/resolve",
        json={"embed_urls": {"direct": "https://fake.example/e1"}, "source": "fake"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["provider"] == "direct"
    assert data["kind"] == "mp4"
    assert data["proxy_url"].startswith("/api/stream/proxy?token=")


def test_resolve_unknown_source_is_400(fake_site_client):
    resp = fake_site_client.post(
        "/api/stream/resolve",
        json={"embed_urls": {"uqload": "https://x/e"}, "source": "nope"},
    )
    assert resp.status_code == 400


def test_resolve_request_without_source_defaults_to_fstream(fake_site_client):
    # Pre-multi-site request body: no source field. Falls back to fstream,
    # whose resolvers can't handle this fake embed — a 502, never a 400/422.
    resp = fake_site_client.post(
        "/api/stream/resolve",
        json={"embed_urls": {"unknown-host": "https://x/e"}},
    )
    assert resp.status_code == 502
