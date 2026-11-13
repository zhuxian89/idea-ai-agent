#!/usr/bin/env python3
"""Correlate browser probes with the same probes at the local Core boundary."""
import argparse
from collections import defaultdict
from datetime import datetime
import json
from pathlib import Path


def analyze(path):
    rows = [json.loads(line) for line in path.read_text().splitlines()]
    core, sent = {}, {}
    clients = defaultdict(lambda: {"core_ms": [], "browser_ms": [], "foreground_lag_ms": [], "closes": []})
    for row in rows:
        if row.get("source") == "core_socket" and row.get("probe"):
            core.setdefault((row["client"], row["probe"]), {})[row["direction"]] = row["observed_at"]
    page_clients = {r["event"]["page"]: r["event"]["client"] for r in rows if r.get("source") == "browser" and r["event"].get("client")}
    for (client, probe), times in core.items():
        if "to_core" in times and "from_core" in times:
            times["elapsed_ms"] = (datetime.fromisoformat(times["from_core"].replace("Z", "+00:00")) - datetime.fromisoformat(times["to_core"].replace("Z", "+00:00"))).total_seconds() * 1000
            clients[client]["core_ms"].append(times["elapsed_ms"])
    seen = set()
    for row in rows:
        if row.get("source") != "browser":
            continue
        event = row["event"]
        identity = (event["page"], event["seq"])
        if identity in seen:
            continue
        seen.add(identity)
        client = event.get("client") or page_clients.get(event["page"])
        if not client:
            continue
        key = (client, event.get("probe"))
        if event["kind"] == "ping":
            sent[key] = event
        elif event["kind"] == "pong" and key in sent:
            clients[client]["browser_ms"].append(event["mono"] - sent[key]["mono"])
        elif event["kind"] == "event_loop_delay" and not event["hidden"]:
            clients[client]["foreground_lag_ms"].append(event["lag_ms"])
        elif event["kind"] in ("client_close", "closed", "error"):
            clients[client]["closes"].append({"event": event, "core": core.get(key, {})})
    def stats(values):
        if not values:
            return {"count": 0}
        ordered = sorted(values)
        return {"count": len(values), "median": round(ordered[len(values)//2], 3), "max": round(max(values), 3)}
    return {client: {"core_ms": stats(data["core_ms"]), "browser_ms": stats(data["browser_ms"]),
                     "foreground_lag_ms": stats(data["foreground_lag_ms"]), "closes": data["closes"]}
            for client, data in clients.items()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("events", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = json.dumps(analyze(args.events), ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(report)
    else:
        print(report, end="")
