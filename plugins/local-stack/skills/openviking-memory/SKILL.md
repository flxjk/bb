---
name: openviking
description: "Search, read, and write the user's local OpenViking context database (viking:// memories, resources, and skills)."
---

# OpenViking

OpenViking is a context database that runs on this machine. It stores what the
user already knows as a virtual filesystem under `viking://`, so you can list,
read, and write it like files. Every directory carries a generated summary, so
scan summaries first and read a full body only when it matters.

Everything is local. The gateway is a loopback address and no request leaves
this host.

## Tools

- `openviking_search` — find memories and resources. Falls back to a content
  search when semantic retrieval is unavailable. A supplied `uri` restricts
  both semantic retrieval and fallback to that subtree.
- `openviking_read` — read one file in full, or its `abstract` / `overview`.
- `openviking_ls` — list a directory.
- `openviking_remember` — write a durable memory.
- `openviking_forget` — delete one memory.
- `openviking_status` — check the gateway.

## CLI

```sh
bb local-stack openviking status [--json]
bb local-stack openviking search <query> [--uri viking://…] [--limit 1-50] [--json]
bb local-stack openviking read <uri> [--detail full|abstract|overview]
bb local-stack openviking ls [uri] [--recursive] [--limit 1-500]
bb local-stack openviking remember <uri> <content> [--mode replace|append]
bb local-stack openviking forget <uri>
```

## Where things live

- `viking://user/default/memories/` — durable user memories.
- `viking://user/default/memories/entities/` — one file per entity.
- `viking://user/default/memories/preferences/` — stated preferences.
- `viking://user/default/memories/events/` — dated events.
- `viking://system/compile/` — compiled skills and templates.

## Retrieve progressively

1. `openviking_search` with a specific query, or `openviking_ls` on a subtree.
2. Read the `abstract` of a promising hit.
3. Read the full body only when the summary is not enough.

## Write deliberately

Save only verified, reusable knowledge: a convention, a decision, a command
that worked, a quirk you confirmed. One focused file per fact, with a
descriptive path. Do not store secrets, guesses, or anything the user asked you
to forget.

```sh
bb local-stack openviking remember viking://user/default/memories/entities/software/foo.md \
  "# Foo

  Foo is configured through foo.toml."
```

Use `--mode append` to extend an existing file instead of replacing it.

## Delete deliberately

`openviking_forget` and `bb local-stack openviking forget` remove one file. Delete only when the
user asks you to forget something, and name the exact file so the deletion is
reviewable.

## When semantic search is unavailable

`openviking_search` reports `Semantic retrieval is unavailable` when the local
embedding model is missing. It then falls back to a content search, which still
works. To restore semantic retrieval, install the local embedding extra in the
OpenViking environment:

```sh
pip install "openviking[local-embed]"
```
