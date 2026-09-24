from app.errors import PathRejected
from app.paths import join_remote, sanitize_rel_path
from tests.conftest import login, write_png


def test_sanitize_rejects_escape_and_accepts_relative_paths():
    assert sanitize_rel_path("") == ""
    assert sanitize_rel_path("album/still.JPG") == "album/still.JPG"
    assert sanitize_rel_path("album/./still.jpg") == "album/still.jpg"
    for bad in ("../etc/passwd", "/etc/passwd", "foo/../../etc", "a/../../b", "foo\\bar", "a\x00b.jpg"):
        try:
            sanitize_rel_path(bad)
        except PathRejected:
            continue
        raise AssertionError(bad)
    try:
        join_remote("/data/remote", "../outside.png")
    except PathRejected:
        return
    raise AssertionError("remote join allowed escape")


def test_http_path_traversal_and_symlink_escape(client, tmp_path):
    assert login(client).status_code == 200
    root = tmp_path / "library"
    nested = root / "album"
    write_png(nested / "keep.png")
    outside = tmp_path / "outside"
    write_png(outside / "secret.png", color=(255, 0, 0))
    (root / "escape.png").symlink_to(outside / "secret.png")
    linked_dir = tmp_path / "linked-dir"
    write_png(linked_dir / "hidden.png")
    (root / "linked").symlink_to(linked_dir)

    created = client.post(
        "/api/sources",
        json={"type": "local", "rootPath": str(root)},
        headers=_headers(client),
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["source"]["id"]

    for bad in (
        "../secret.png",
        "/etc/passwd",
        "album/../../secret.png",
        "linked/hidden.png",
        "escape.png",
    ):
        for url in (
            f"/api/sources/{source_id}/tree",
            f"/api/sources/{source_id}/stills",
            f"/api/media/{source_id}/thumb",
            f"/api/media/{source_id}/full",
        ):
            response = client.get(url, params={"path": bad})
            assert response.status_code == 400, (url, bad, response.text)
            assert response.json()["error"]["code"] == "path_rejected"

    tree = client.get(f"/api/sources/{source_id}/tree")
    assert tree.status_code == 200, tree.text
    names = [entry["name"] for entry in tree.json()["entries"]]
    assert "album" in names
    assert "escape.png" not in names
    assert "linked" not in names

    stills = client.get(f"/api/sources/{source_id}/stills", params={"path": "album"})
    assert stills.status_code == 200
    assert stills.json()["stills"][0]["relPath"] == "album/keep.png"

    thumb = client.get(
        f"/api/media/{source_id}/thumb",
        params={"path": "album/keep.png"},
    )
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/webp")


def _headers(client):
    from tests.conftest import csrf_headers

    return csrf_headers(client)
