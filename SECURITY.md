# Security policy

Eyrie runs a local HTTP and WebSocket server that serves your source code to your browser and can launch your editor. Problems in that surface matter, so please report them privately.

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

- Preferred: open a [private vulnerability report](https://github.com/eyrie-hq/eyrie/security/advisories/new) on GitHub.
- Or email the maintainer, Badhan Sen, at **badhan.cse@gmail.com** with `[eyrie security]` in the subject.

Please include what you found, how to reproduce it (a minimal repository or request sequence is ideal), and the commit you tested against.

You can expect an acknowledgement within **7 days** and an assessment, with a plan for a fix, within **30 days**. You will be credited in the fix unless you ask not to be.

## Supported versions

Eyrie has no tagged releases yet. Fixes land on `main`; please test against the latest commit before reporting.

## Scope

In scope: anything that lets code or people other than the user running Eyrie read files, run commands, or reach the server. For example:

- bypassing the per-run access token on `/api/*` or the WebSocket upgrade
- reaching the server from another origin or host (the `Host` header allowlist is the DNS-rebinding defence)
- reading a file through `/api/source` that is not in the index, or that `.gitignore` / `.eyrieignore` excludes
- path traversal in static file serving
- making the open-in-editor action run anything other than the configured editor on an indexed file

Out of scope: running Eyrie with `--host 0.0.0.0` (or another non-loopback interface) on an untrusted network and sharing the token, and denial of service from scanning a very large or adversarial repository on your own machine.

## What Eyrie already does

The server binds to `127.0.0.1` by default, requires a random per-run token on every API request and on the WebSocket, rejects requests whose `Host` header is not local, caps request bodies, and serves source only for files in the index. Eyrie makes no outbound network requests. See [Privacy and security](README.md#privacy-and-security) in the README.
