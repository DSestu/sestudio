"""Whether phones and TVs can reach the server: firewall rules, the self-test,
and the cert following the machine onto a new network."""

from __future__ import annotations

import socket

from cryptography import x509

import sestudio.tls as tls
from sestudio import lan


def rules(*pairs: tuple[str, str]) -> list[dict]:
    return [{"action": action, "profile": profile} for action, profile in pairs]


def test_an_allow_rule_on_the_network_category_lets_devices_in() -> None:
    state = {
        "categories": "Private",
        "off": [],
        "rules": rules(("Allow", "Private, Public")),
    }
    assert lan.blocked_by_rules(state) is None


def test_a_block_rule_wins_over_an_allow() -> None:
    state = {
        "categories": ["Private"],
        "off": [],
        "rules": rules(("Allow", "Any"), ("Block", "Private")),
    }
    assert lan.blocked_by_rules(state) == "Private"


def test_no_rule_for_the_category_is_blocked_unless_its_firewall_is_off() -> None:
    state = {"categories": ["Public"], "off": [], "rules": rules(("Allow", "Private"))}
    assert lan.blocked_by_rules(state) == "Public"
    assert lan.blocked_by_rules({**state, "off": "Public"}) is None


def test_off_windows_the_firewall_is_not_read(monkeypatch) -> None:
    monkeypatch.setattr(lan.sys, "platform", "linux")
    assert lan.firewall_blocks("192.168.1.5") is None


def test_an_address_that_does_not_answer_is_unreachable() -> None:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]  # bound, not listening
        assert lan.problem("127.0.0.1", port, firewalled=None) == "unreachable"
        sock.listen()
        assert lan.problem("127.0.0.1", port, firewalled=None) is None
        assert lan.problem("127.0.0.1", port, firewalled="Private") == "firewall"


def test_no_network_is_offline(monkeypatch) -> None:
    monkeypatch.setattr(lan, "primary_ip", lambda: None)
    state = lan.state("https", 8443, 8080)
    assert (state["url"], state["problem"]) == (None, "offline")


def covered(cert_path) -> set[str]:
    cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    return {str(ip) for ip in san.get_values_for_type(x509.IPAddress)}


def test_a_new_lan_address_gets_a_cert_that_keeps_the_old_one(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(tls, "_local_ipv4s", lambda: ["192.168.1.5"])
    cert_path, _key = tls.ensure_cert(cache_dir=tmp_path)
    monkeypatch.setattr(tls, "_local_ipv4s", lambda: ["10.0.0.7"])
    tls.ensure_cert(cache_dir=tmp_path)
    assert {"192.168.1.5", "10.0.0.7"} <= covered(cert_path)

    # Back on the first network: already covered, so the same cert.
    before = cert_path.read_bytes()
    monkeypatch.setattr(tls, "_local_ipv4s", lambda: ["192.168.1.5"])
    tls.ensure_cert(cache_dir=tmp_path)
    assert cert_path.read_bytes() == before
