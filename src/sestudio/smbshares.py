"""The shares of an SMB box, and what a login may do in each, read-only
(SPEC-storage §10, PR 25).

Shares are asked of the box's share service (``srvsvc``, NetrShareEnum level 1)
over its ``IPC$`` pipe, with the same SMB2/3 library the files are later read
with. Access is asked, never tried: each share's top folder is opened requesting
the right to list it, then the right to add files and folders to it, and closed.
An open of what already exists creates nothing, so nothing of sestudio is ever
left on the box.
"""

from __future__ import annotations

import struct
import uuid
from typing import Any

#: srvsvc's interface, and NDR's transfer syntax (MS-SRVS, MS-RPCE).
_SRVSVC = (uuid.UUID("4b324fc8-1670-01d3-1278-5a47bf6ee188"), 3, 0)
_NDR = (uuid.UUID("8a885d04-1ceb-11c9-9fe8-08002b104860"), 2)
_NETR_SHARE_ENUM = 15
_DISK = 0  # STYPE_DISKTREE, the low bits of a share's type


class Refused(Exception):
    """The login was not accepted."""


def _bind() -> bytes:
    iface, major, minor = _SRVSVC
    ndr, ndr_ver = _NDR
    body = struct.pack(
        "<HHIHBB", 4280, 4280, 0, 1, 1, 0
    )  # max frags, group, one context
    body += (
        struct.pack("<HBB", 0, 1, 0) + iface.bytes_le + struct.pack("<HH", major, minor)
    )
    body += ndr.bytes_le + struct.pack("<I", ndr_ver)
    return _pdu(11, body, call_id=1)


def _pdu(ptype: int, body: bytes, call_id: int) -> bytes:
    # version 5.0, type, first|last fragment, little-endian NDR data representation
    return (
        struct.pack(
            "<BBBB4sHHI",
            5,
            0,
            ptype,
            3,
            b"\x10\x00\x00\x00",
            16 + len(body),
            0,
            call_id,
        )
        + body
    )


def _wstr(text: str) -> bytes:
    """An NDR conformant varying string, NUL-ended, padded to 4 bytes."""
    data = (text + "\0").encode("utf-16-le")
    n = len(data) // 2
    out = struct.pack("<III", n, 0, n) + data
    return out + b"\0" * (-len(out) % 4)


def _enum_request(host: str) -> bytes:
    stub = struct.pack("<I", 0x00020000) + _wstr(
        f"\\\\{host}"
    )  # ServerName (unique pointer)
    stub += struct.pack("<II", 1, 1)  # Level 1, union switch 1
    stub += struct.pack(
        "<III", 0x00020004, 0, 0
    )  # SHARE_INFO_1_CONTAINER: 0 entries, no buffer
    stub += struct.pack("<II", 0xFFFFFFFF, 0)  # PreferedMaximumLength, no ResumeHandle
    body = struct.pack("<IHH", len(stub), 0, _NETR_SHARE_ENUM) + stub
    return _pdu(0, body, call_id=2)


def parse_shares(response: bytes) -> list[tuple[str, int]]:
    """(name, type) of each share in a NetrShareEnum level 1 answer."""
    stub = response[24:]  # the response PDU's header, then its stub

    def u32(at: int) -> int:
        return struct.unpack_from("<I", stub, at)[0]

    count = u32(12)  # level, switch, container pointer, then EntriesRead
    if not count or not u32(16):
        return []
    at = 24  # past the buffer pointer and the array's max count
    types = []
    for _ in range(count):
        types.append(u32(at + 4))  # name pointer, type, remark pointer
        at += 12

    def string(at: int) -> tuple[str, int]:
        actual = u32(at + 8)
        start = at + 12
        text = stub[start : start + actual * 2].decode("utf-16-le").rstrip("\0")
        end = start + actual * 2
        return text, end + (-end % 4)

    out = []
    for kind in types:
        name, at = string(at)
        _remark, at = string(at)
        out.append((name, kind))
    return out


def _session(host: str, port: int, user: str, password: str, timeout: float):
    from smbprotocol.connection import Connection
    from smbprotocol.exceptions import LogonFailure, SMBAuthenticationError
    from smbprotocol.session import Session

    guest = user in ("", "guest") and not password
    # A guest session has no key to sign with: signing and the negotiation check are off for it.
    conn = Connection(uuid.uuid4(), host, port, require_signing=not guest)
    conn.connect(timeout=timeout)
    try:
        session = Session(conn, username="guest" if guest else user, password=password,
                          require_encryption=False, auth_protocol="ntlm")  # fmt: skip
        session.connect()
    except (SMBAuthenticationError, LogonFailure):
        conn.disconnect()
        raise Refused from None
    except Exception:
        conn.disconnect()
        raise
    return conn, session, guest


def _may(tree: Any, access: int) -> bool:
    """Whether the top folder opens with *access*: asked, never tried."""
    from smbprotocol.exceptions import SMBResponseException
    from smbprotocol.open import (
        CreateDisposition,
        CreateOptions,
        FileAttributes,
        ImpersonationLevel,
        Open,
        ShareAccess,
    )

    top = Open(tree, "")
    try:
        top.create(
            ImpersonationLevel.Impersonation,
            access,
            FileAttributes.FILE_ATTRIBUTE_DIRECTORY,
            ShareAccess.FILE_SHARE_READ
            | ShareAccess.FILE_SHARE_WRITE
            | ShareAccess.FILE_SHARE_DELETE,
            CreateDisposition.FILE_OPEN,  # opens what is there, never creates
            CreateOptions.FILE_DIRECTORY_FILE,
        )
    except SMBResponseException:
        return False
    top.close()
    return True


def shares(
    host: str, port: int, user: str, password: str, timeout: float = 6.0
) -> list[dict[str, Any]]:
    """Each disk share of the box, with whether *user* may read it and write to it."""
    from smbprotocol.open import (
        CreateDisposition,
        CreateOptions,
        DirectoryAccessMask,
        FileAttributes,
        FilePipePrinterAccessMask,
        ImpersonationLevel,
        Open,
        ShareAccess,
    )
    from smbprotocol.tree import TreeConnect

    conn, session, guest = _session(host, port, user, password, timeout)
    try:
        ipc = TreeConnect(session, rf"\\{host}\IPC$")
        ipc.connect(require_secure_negotiate=not guest)
        pipe = Open(ipc, "srvsvc")
        pipe.create(
            ImpersonationLevel.Impersonation,
            FilePipePrinterAccessMask.FILE_READ_DATA
            | FilePipePrinterAccessMask.FILE_WRITE_DATA,
            FileAttributes.FILE_ATTRIBUTE_NORMAL,
            ShareAccess.FILE_SHARE_READ | ShareAccess.FILE_SHARE_WRITE,
            CreateDisposition.FILE_OPEN,
            CreateOptions.FILE_NON_DIRECTORY_FILE,
        )
        pipe.write(_bind())
        pipe.read(0, 4280)
        pipe.write(_enum_request(host))
        answer = pipe.read(0, 65536)
        pipe.close()
        out = []
        for name, kind in parse_shares(answer):
            # Disk shares only: not IPC$, not the admin shares (C$, ADMIN$), not printers.
            if kind & 0x0FFFFFFF != _DISK or name.endswith("$"):
                continue
            tree = TreeConnect(session, rf"\\{host}\{name}")
            try:
                tree.connect(require_secure_negotiate=not guest)
            except Exception:  # noqa: BLE001 - not for this login
                out.append({"name": name, "read": False, "write": False})
                continue
            read = _may(tree, DirectoryAccessMask.FILE_LIST_DIRECTORY)
            write = _may(
                tree,
                DirectoryAccessMask.FILE_ADD_FILE
                | DirectoryAccessMask.FILE_ADD_SUBDIRECTORY,
            )
            out.append({"name": name, "read": read, "write": write})
        return out
    finally:
        try:
            conn.disconnect()
        except Exception:  # noqa: BLE001
            pass
