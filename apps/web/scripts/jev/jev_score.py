"""Jev scorer sidecar for the /dev/jev lab (lib/server/jev/jevClient.ts spawns it).

Vendored from github.com/Anmol-Srv/jev-video-search core.py (jev_stream): one Jev
request per (query, caption) pair, 25 in flight, same pinned model and the same
DEPICTS question, so the 0.55 floor calibrated there still applies.

stdin : {"query": str, "captions": [str, ...]}
stdout: one JSON line per answer AS IT LANDS: {"i": int, "score": float|null}
        then {"done": true}. A fatal setup problem prints {"error": str} instead.

Setup: pip install typesafe-sdk ; export TYPESAFE_API_KEY=... (or ~/.sigil/config.json)
"""
import json, os, sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

JEV_MODEL = os.environ.get("JEV_MODEL", "jev-1.13.0")  # thresholds are calibrated to it
MAX_CAPTION_CHARS = 1200
MAX_QUERY_CHARS = 1000
CONCURRENCY = int(os.environ.get("JEV_CONCURRENCY", "25"))

# The relationship clause is the point: it is the thing a retriever drops.
DEPICTS = {
    "instructions": (
        "`query` is what a viewer is searching for in a video. `scene.caption` describes "
        "one scene from a video. Does that scene show what the query describes, including "
        "the relationship, setting, or activity the query specifies between the things in it?"
    ),
    "criteria": {
        "true": ("The scene shows the queried subjects and objects in the queried "
                 "relationship, setting, or activity."),
        "false": ("The scene contains some of the queried things but not in the queried "
                  "relationship or setting, or is merely on a similar topic."),
    },
}


def emit(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def jev_key():
    if os.environ.get("TYPESAFE_API_KEY"):
        return os.environ["TYPESAFE_API_KEY"]
    cfg = Path.home() / ".sigil" / "config.json"
    if cfg.exists():
        return json.loads(cfg.read_text()).get("jev", {}).get("apiKey")
    return None


def main():
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except ValueError as e:
        return emit({"error": f"bad input: {e}"})
    query = str(req.get("query", ""))[:MAX_QUERY_CHARS]
    captions = [str(c)[:MAX_CAPTION_CHARS] for c in req.get("captions", [])]

    key = jev_key()
    if not key:
        return emit({"error": "no TYPESAFE_API_KEY (or ~/.sigil/config.json jev.apiKey)"})
    try:
        from typesafe_sdk import Noul, TypeSafeClient
    except ImportError:
        return emit({"error": "typesafe-sdk not installed: pip install typesafe-sdk"})

    with TypeSafeClient(api_key=key, model=JEV_MODEL, timeout=20.0) as client:
        def one(i, cap):
            try:
                resp = client.system_one(
                    state={"query": query, "scene": {"caption": cap}},
                    questions={"depicts_query": Noul(**DEPICTS)},
                )
                return i, float(resp.nouls["depicts_query"].noul)
            except Exception:
                return i, None  # unscored keeps its retriever rank

        def wave(indices, workers):
            results = {}
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(one, i, captions[i]) for i in indices]
                for f in as_completed(futures):
                    i, score = f.result()
                    results[i] = score
            return results

        # One bounded wave, matching the upstream implementation. Retrying every
        # miss can turn a transient provider problem into another full timeout;
        # null scores safely retain their retriever order in the caller.
        results = wave(range(len(captions)), CONCURRENCY)
        for i, score in results.items():
            emit({"i": i, "score": score})
    emit({"done": True})


if __name__ == "__main__":
    main()
