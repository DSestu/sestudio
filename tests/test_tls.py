from __future__ import annotations

import ipaddress

from cryptography import x509

import sestudio.tls as tls


def test_cert_has_expected_sans(tmp_path, monkeypatch):
    monkeypatch.setattr(tls, "_local_ipv4s", lambda: ["192.168.1.50"])
    cert_path, key_path = tls.ensure_cert(cache_dir=tmp_path)
    assert cert_path.exists() and key_path.exists()

    cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    ips = set(san.get_values_for_type(x509.IPAddress))
    dns = set(san.get_values_for_type(x509.DNSName))

    assert ipaddress.ip_address("127.0.0.1") in ips
    assert ipaddress.ip_address("192.168.1.50") in ips
    assert "localhost" in dns


def test_cache_reuse(tmp_path, monkeypatch):
    monkeypatch.setattr(tls, "_local_ipv4s", lambda: [])
    c1, k1 = tls.ensure_cert(cache_dir=tmp_path)

    calls: list[int] = []
    monkeypatch.setattr(tls, "_generate", lambda *a, **k: calls.append(1))
    c2, k2 = tls.ensure_cert(cache_dir=tmp_path)

    assert (c1, k1) == (c2, k2)
    assert calls == []  # cached cert reused, not regenerated
