#!/usr/bin/env python3
"""
find_leads.py — Find Malaysian long-form publishers who need clipping.

Targets the archetype verified on 23 Aug 2026: a credentialed professional
who publishes educational long-form video to win high-ticket clients, and
gets terrible view counts.

The counterintuitive filter: LOW views are the buying signal. High views mean
they solved it or have a team. A licensed planner posting weekly to 50 views
is maximum pain and maximum ability to pay.

Setup:
    pip install google-api-python-client
    export YOUTUBE_API_KEY="..."      # console.cloud.google.com, free, 10k units/day

Run:
    python3 find_leads.py                 # Malaysia
    python3 find_leads.py --region SG     # Singapore: same timezone, ~3x the budget

Quota: each keyword costs ~100 units, so ~90 keywords/day on the free tier.
"""

import os
import csv
import sys
import argparse
from datetime import datetime, timedelta, timezone

from googleapiclient.discovery import build

# --- The archetype's search terms -------------------------------------------
# THE RULE: only target industries where ONE client is worth >= 10x your monthly
# fee. At RM1,500/mo that means client value >= RM15,000. Below that, the buyer
# has to attribute several new customers a month just to break even, and no
# clipping service can promise that. Above it, one extra client a YEAR pays for
# you — and that sells itself.
#
# Malay terms have far less competition than English and surface credentialed
# professionals rather than creators.

KEYWORDS = [
    # === TIER S: client worth RM20k-100k+, pure trust sale, they already publish ===

    # Estate planning / wasiat / hibah — Malaysia's most underserved goldmine.
    # Emotionally charged, legally necessary, RM2k-20k per plan, whole agent
    # industries behind it (Rockwills, As-Salihin, Amanah Raya panels).
    "wasiat", "hibah", "faraid", "perancangan harta pusaka", "harta pusaka beku",
    "estate planning Malaysia", "amanah raya", "wasiat islam",

    # Financial planning / advisory — VERIFIED archetype (CF Lieu)
    "perancang kewangan", "perancangan persaraan", "financial planner Malaysia",
    "pelaburan saham Malaysia", "unit trust Malaysia", "KWSP EPF pelaburan",
    "financial freedom Malaysia",

    # Insurance / takaful — recruitment income exceeds sales income
    "takaful", "insurans hayat", "medical card Malaysia", "agen takaful",
    "kerjaya takaful", "recruitment agent insurans",

    # Immigration / overseas education agents — RM10k-50k per family, all trust,
    # they run webinars constantly and nobody clips them
    "immigration consultant Malaysia", "study abroad Malaysia", "belajar luar negara",
    "visa Australia Malaysia", "migrate to Australia Malaysia", "PR application Malaysia",

    # Lawyers — family, corporate, IP. High ticket, trust sale, newly publishing
    "peguam Malaysia", "guaman sivil", "hak penjagaan anak", "syarikat sdn bhd guaman",

    # === TIER A: client worth RM15k-50k, footage exists ===

    # Corporate trainers / HRD Corp claimable — they record every session and
    # compete for levy spend. Structurally perfect source footage.
    "HRDF HRD Corp training", "kursus korporat Malaysia", "trainer Malaysia",
    "latihan pekerja Malaysia",

    # Franchise & business-opportunity sellers — recruitment webinars weekly,
    # franchise fees RM50k-500k
    "peluang francais Malaysia", "franchise Malaysia", "beli bisnes Malaysia",

    # Property investment coaches — seminars recorded, courses RM3k-30k
    "pelaburan hartanah", "property investment Malaysia", "beli rumah pertama",
    "rumah lelong Malaysia",

    # Tax / accounting advisory — recurring, forced, professional
    "cukai LHDN", "SST Malaysia", "audit syarikat Malaysia", "e-invoice Malaysia",

    # Business coaching / consulting
    "coach bisnes", "usahawan Malaysia", "scale bisnes Malaysia",

    # Medical & aesthetic — RM5k-50k per case, but often already agency-served
    "aesthetic clinic Malaysia", "doktor pakar Malaysia", "hair transplant Malaysia",
]

# Industries deliberately EXCLUDED — they fail the 10x rule:
#   e-commerce / dropshipping (client worth RM50-200)
#   restaurants & F&B (worth RM30-100)
#   tuition centres (worth RM2-5k, thin margins)
#   entertainers, vloggers, gaming (no client at all — ad revenue only)
#   news/media channels (no client, and they have in-house teams)

# --- Filters ----------------------------------------------------------------
MIN_DURATION_SEC = 300       # 5 min — below this there is nothing to cut
MAX_VIEWS = 5_000            # the pain signal. Do not raise this.
MIN_SUBS = 500               # below this, usually no money
MAX_SUBS = 400_000           # above this, they likely have an editor
DAYS_ACTIVE = 45             # dead channels killed 4 of the podcast prospects


def iso_duration_to_seconds(iso: str) -> int:
    """PT1H8M11S -> 4091"""
    import re
    m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso or "")
    if not m:
        return 0
    h, mi, s = (int(x) if x else 0 for x in m.groups())
    return h * 3600 + mi * 60 + s


def find_leads(api_key: str, region: str = "MY", language: str = "ms"):
    yt = build("youtube", "v3", developerKey=api_key)
    after = (datetime.now(timezone.utc) - timedelta(days=DAYS_ACTIVE)).isoformat()

    video_ids, seen = [], set()

    for kw in KEYWORDS:
        try:
            res = yt.search().list(
                q=kw, part="id", type="video", maxResults=50,
                videoDuration="medium",          # 4–20 min: the archetype's range
                publishedAfter=after,
                regionCode=region,
                relevanceLanguage=language,
                order="date",
            ).execute()
        except Exception as e:
            print(f"  ! {kw}: {e}", file=sys.stderr)
            continue

        ids = [i["id"]["videoId"] for i in res.get("items", []) if i["id"].get("videoId")]
        video_ids += [v for v in ids if v not in seen]
        seen.update(ids)
        print(f"  {kw}: {len(ids)} videos", file=sys.stderr)

    print(f"\n{len(video_ids)} candidate videos. Fetching stats...\n", file=sys.stderr)

    # videos.list costs 1 unit per call, 50 ids at a time
    channels, video_of = {}, {}
    for i in range(0, len(video_ids), 50):
        res = yt.videos().list(
            part="snippet,statistics,contentDetails", id=",".join(video_ids[i:i + 50])
        ).execute()
        for v in res.get("items", []):
            snip = v.get("snippet", {})
            # Live streams and scheduled premieres carry no duration — skip them.
            if snip.get("liveBroadcastContent") in ("live", "upcoming"):
                continue
            raw = v.get("contentDetails", {}).get("duration")
            if not raw or raw == "P0D":
                continue
            dur = iso_duration_to_seconds(raw)
            stats = v.get("statistics", {})
            if "viewCount" not in stats:      # views hidden by the owner
                continue
            views = int(stats["viewCount"])
            if dur < MIN_DURATION_SEC or views > MAX_VIEWS:
                continue
            cid = v["snippet"]["channelId"]
            # keep the most recent qualifying video per channel
            if cid not in video_of or v["snippet"]["publishedAt"] > video_of[cid]["published"]:
                video_of[cid] = {
                    "title": v["snippet"]["title"],
                    "url": f"https://youtu.be/{v['id']}",
                    "published": v["snippet"]["publishedAt"][:10],
                    "duration_min": round(dur / 60, 1),
                    "views": views,
                }
            channels[cid] = v["snippet"]["channelTitle"]

    # channels.list — subs, total videos, and the description (where the sales link lives)
    rows, cids = [], list(channels)
    for i in range(0, len(cids), 50):
        res = yt.channels().list(
            part="snippet,statistics,brandingSettings", id=",".join(cids[i:i + 50])
        ).execute()
        for c in res.get("items", []):
            st = c["statistics"]
            if st.get("hiddenSubscriberCount"):
                continue
            subs = int(st.get("subscriberCount", 0))
            if not (MIN_SUBS <= subs <= MAX_SUBS):
                continue
            v = video_of[c["id"]]
            desc = c["snippet"].get("description", "")
            sells = any(t in desc.lower() for t in
                        ("http", "www.", "whatsapp", "wa.me", "consult", "booking", "hubungi"))
            rows.append({
                "channel": c["snippet"]["title"],
                "url": f"https://youtube.com/channel/{c['id']}",
                "subs": subs,
                "total_videos": int(st.get("videoCount", 0)),
                "last_upload": v["published"],
                "length_min": v["duration_min"],
                "views": v["views"],
                # low views + high output + sells something = the archetype
                "score": round((int(st.get("videoCount", 1)) / max(v["views"], 1)) * (10 if sells else 1), 2),
                "sells_something": "YES" if sells else "no",
                "latest_video": v["url"],
                "notes": v["title"][:80],
            })

    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--region", default="MY")
    ap.add_argument("--language", default="ms")
    ap.add_argument("--out", default="leads.csv")
    args = ap.parse_args()

    key = os.environ.get("YOUTUBE_API_KEY")
    if not key:
        sys.exit("Set YOUTUBE_API_KEY first (console.cloud.google.com — free)")

    rows = find_leads(key, args.region, args.language)
    if not rows:
        sys.exit("No leads matched. Loosen MAX_VIEWS or widen KEYWORDS.")

    with open(args.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)

    print(f"\n{len(rows)} leads -> {args.out}\n")
    print(f"{'CHANNEL':<34}{'SUBS':>8}{'VIDS':>7}{'VIEWS':>8}{'MIN':>6}  SELLS")
    print("-" * 78)
    for r in rows[:30]:
        print(f"{r['channel'][:33]:<34}{r['subs']:>8}{r['total_videos']:>7}"
              f"{r['views']:>8}{r['length_min']:>6}  {r['sells_something']}")
    print("\nTop of the list = most videos, fewest views, sells something.")
    print("That is maximum pain and maximum ability to pay. Start at the top.")


if __name__ == "__main__":
    main()
