"""Run the real chat UI with an isolated guest and a deterministic RPC transport."""
import json
import os
import shutil
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def check(browser, origin):
    room = "00000000-0000-4000-8000-000000000001"
    guest = dict(room=room, key="ab" * 32, guest="cd" * 32, accepted=True, group=True)
    context = browser.new_context()
    context.add_init_script("localStorage.setItem(" + json.dumps("qinti-chat-guest:" + room)
                            + "," + json.dumps(json.dumps(guest)) + ")")
    page = context.new_page()
    messages = [dict(seq=i, sender=str(i), packet="00", from_host=False, mine=False)
                for i in range(1, 236)]
    send_ids = []
    fail_read = False
    drop_reply = False

    def rpc(route):
        nonlocal drop_reply
        args = route.request.post_data_json
        headers = {"Access-Control-Allow-Origin": "*"}
        if route.request.url.endswith("/qinti_history"):
            eligible = [m for m in messages if m["seq"] < (args.get("before_seq") or 10**9)]
            data = dict(messages=eligible[-100:], has_older=len(eligible) > 100, title="Test", members=2)
        elif args["action"] == "send":
            msg_id = args["message_id"]
            if msg_id not in send_ids:
                messages.append(dict(seq=messages[-1]["seq"] + 1, packet=args["payload"],
                                     from_host=False, sender="Me", mine=True))
            send_ids.append(msg_id)
            if drop_reply:
                drop_reply = False
                route.abort()
                return
            data = True
        elif fail_read:
            route.fulfill(status=503, json={"message": "offline"}, headers=headers)
            return
        else:
            data = dict(messages=[m for m in messages if m["seq"] > args["cursor_seq"]][:100],
                        title="Test", members=2)
        route.fulfill(json=data, headers=headers)

    page.route("**/rest/v1/rpc/**", rpc)
    page.goto(origin + "/chat.html#room=" + room)
    items = page.locator("#messages li")
    expect(items).to_have_count(100)
    expect(items.first.locator(".sender")).to_have_text("成员 · 136")
    expect(items.last.locator(".sender")).to_have_text("成员 · 235")
    page.locator("#older").click()
    expect(items).to_have_count(200)
    page.locator("#older").click()
    expect(items).to_have_count(235)
    assert page.locator("#messages .sender").all_text_contents() == ["成员 · " + str(i) for i in range(1, 236)]
    expect(page.locator("#older")).to_be_hidden()

    fail_read = True
    draft = page.locator("#draft")
    draft.fill("refresh test")
    draft.press("Enter")
    expect(page.locator("#retryRefresh")).to_be_visible()
    expect(page.locator("#status")).to_contain_text("已发送")
    expect(draft).to_have_value("")
    fail_read = False
    page.locator("#retryRefresh").click()
    expect(items.last).to_contain_text("refresh test")
    assert len(send_ids) == 1

    drop_reply = True
    draft.fill("retry test")
    draft.press("Enter")
    expect(page.locator("#status")).to_contain_text("可再次点发送")
    expect(draft).to_have_value("retry test")
    page.locator("#send").click()
    expect(draft).to_have_value("")
    expect(items).to_have_count(237)
    assert len(send_ids) == 3 and send_ids[1] == send_ids[2]
    context.close()


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=root))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with sync_playwright() as playwright:
            chrome = shutil.which("google-chrome") or os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
            browser = playwright.chromium.launch(executable_path=chrome if Path(chrome).exists() else None)
            check(browser, "http://127.0.0.1:" + str(server.server_port))
            browser.close()
        print("PASS: latest and older history, refresh failure, safe send retry")
    finally:
        server.shutdown()
        server.server_close()
