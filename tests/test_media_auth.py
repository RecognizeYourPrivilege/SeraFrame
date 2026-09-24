from io import BytesIO

from PIL import Image

from tests.conftest import csrf_headers, login, write_png


def test_media_and_catalog_require_a_session(client):
    probes = [
        "/api/sources",
        "/api/sources/suggestions",
        "/api/servers",
        "/api/media/missing/thumb",
        "/api/media/missing/thumb?path=../secret.jpg",
        "/api/media/missing/full",
        "/api/media/missing/full?path=a.jpg",
    ]
    for url in probes:
        response = client.get(url)
        assert response.status_code == 401, url
        assert response.json()["error"]["code"] == "unauthorized"


def test_local_listing_thumb_cache_and_secret_omission(client, tmp_path):
    assert login(client).status_code == 200
    root = tmp_path / "library"
    write_png(root / "b.png", size=(400, 100), color=(10, 20, 30))
    write_png(root / "a.JPG", size=(10, 10), color=(1, 2, 3))
    (root / "notes.txt").write_text("ignore me", encoding="utf-8")
    write_png(root / "nested" / "one.png")

    created = client.post(
        "/api/sources",
        json={"type": "local", "rootPath": str(root), "label": "Library"},
        headers=csrf_headers(client),
    )
    assert created.status_code == 201, created.text
    source = created.json()["source"]
    assert source["label"] == "Library"
    assert source["rootPath"] == str(root)
    assert "password" not in source
    assert "privateKey" not in source

    listed = client.get("/api/sources")
    assert listed.status_code == 200
    assert "password" not in listed.text.lower()
    assert "privatekey" not in listed.text.lower()
    assert source["id"] in listed.text

    suggestions = client.get("/api/sources/suggestions")
    assert suggestions.status_code == 200
    assert isinstance(suggestions.json()["paths"], list)

    tree = client.get(f"/api/sources/{source['id']}/tree")
    assert tree.status_code == 200
    by_name = {entry["name"]: entry for entry in tree.json()["entries"]}
    assert "notes.txt" not in by_name
    assert by_name["nested"]["kind"] == "dir"
    assert by_name["nested"]["stillCount"] == 1
    assert [entry["name"] for entry in tree.json()["entries"] if entry["kind"] == "still"] == [
        "a.JPG",
        "b.png",
    ]

    stills = client.get(f"/api/sources/{source['id']}/stills")
    assert [item["relPath"] for item in stills.json()["stills"]] == ["a.JPG", "b.png"]
    thumb_url = stills.json()["stills"][1]["thumbUrl"]
    full_url = stills.json()["stills"][1]["fullUrl"]
    assert thumb_url.startswith(f"/api/media/{source['id']}/thumb?path=")
    assert "b.png" in thumb_url

    thumb = client.get(thumb_url)
    assert thumb.status_code == 200
    assert thumb.headers["content-type"].startswith("image/webp")
    with Image.open(BytesIO(thumb.content)) as image:
        assert image.format == "WEBP"
        assert max(image.size) <= 256
    assert client.get(thumb_url).status_code == 200

    original = (root / "b.png").read_bytes()
    full = client.get(full_url)
    assert full.status_code == 200
    assert full.headers["content-type"].startswith("image/png")
    assert full.content == original


def test_thumb_cache_is_purged_when_source_is_deleted(client, tmp_path):
    assert login(client).status_code == 200
    root = tmp_path / "library"
    write_png(root / "shot.png", size=(300, 80))
    created = client.post(
        "/api/sources",
        json={"type": "local", "rootPath": str(root)},
        headers=csrf_headers(client),
    )
    source_id = created.json()["source"]["id"]
    thumb = client.get(f"/api/media/{source_id}/thumb", params={"path": "shot.png"})
    assert thumb.status_code == 200
    cache_root = tmp_path / "data" / "thumbs" / source_id
    assert cache_root.is_dir()
    assert any(cache_root.glob("*.webp"))

    deleted = client.delete(f"/api/sources/{source_id}", headers=csrf_headers(client))
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}
    assert not cache_root.exists()
    missing = client.get(f"/api/media/{source_id}/full", params={"path": "shot.png"})
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "not_found"
