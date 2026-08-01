from __future__ import annotations

import datetime
import ipaddress
import logging
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

from sestudio.config import _config_path
from sestudio.dlna import _local_ipv4s

logger = logging.getLogger(__name__)

_CERT_NAME = "cert.pem"
_KEY_NAME = "key.pem"


def _cache_dir() -> Path:
    """Where the cert/key are cached — alongside the app config."""
    return _config_path().parent


def _san_entries() -> list[x509.GeneralName]:
    """SANs so cast devices trust the cert by LAN IP: loopback + localhost + LAN IPv4s."""
    entries: list[x509.GeneralName] = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    for ip in _local_ipv4s():
        try:
            entries.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            continue
    return entries


def _still_valid(cert_path: Path) -> bool:
    try:
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
    except Exception:
        return False
    now = datetime.datetime.now(datetime.timezone.utc)
    return cert.not_valid_after_utc > now + datetime.timedelta(days=1)


def _generate(cert_path: Path, key_path: Path) -> None:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "sestudio")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=825))
        .add_extension(x509.SubjectAlternativeName(_san_entries()), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    try:
        key_path.chmod(0o600)
    except OSError:
        pass
    logger.info("Generated self-signed cert at %s", cert_path)


def ensure_cert(cache_dir: Path | None = None) -> tuple[Path, Path]:
    """Return ``(cert_path, key_path)`` for a self-signed cert covering the LAN IPs.

    Generated once and cached under the config dir; regenerated only when missing
    or within a day of expiry.
    """
    directory = cache_dir or _cache_dir()
    cert_path = directory / _CERT_NAME
    key_path = directory / _KEY_NAME
    if cert_path.exists() and key_path.exists() and _still_valid(cert_path):
        return cert_path, key_path
    directory.mkdir(parents=True, exist_ok=True)
    _generate(cert_path, key_path)
    return cert_path, key_path
