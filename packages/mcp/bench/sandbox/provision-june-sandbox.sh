#!/usr/bin/env bash
# ============================================================================
# provision-june-sandbox.sh
#
# Kernel-level lockdown for the RSI optimizer user `june`.
#
# RUN AS ROOT, ONCE, at provisioning time (and after a WSL reboot for the
# iptables rules — see the systemd unit this installs).
#
#   sudo bash packages/mcp/bench/sandbox/provision-june-sandbox.sh
#
# What it enforces (the two sandboxes the RSI design requires):
#   1. PRIVILEGE  — `june` is unprivileged: NOT in sudo/docker/wheel, no
#                   sudoers entry. (Solves the docker-group host-escape: a
#                   process in `docker` can mount the host FS and bypass
#                   everything, so the optimizer must not be `cam`.)
#   2. EGRESS     — uid=june is forced through a local allowlisting CONNECT
#                   proxy via an iptables owner-match chain. The proxy is the
#                   single logged choke point. Default policy = STRICT
#                   ALLOWLIST (Ollama + Qdrant + optional DeepSeek-flash only).
#                   api.anthropic.com / api.openai.com are unreachable.
#
# What this script does NOT (and cannot) fully do — see SEALING THE GAUGE:
#   The no-read gauge (§1) needs the fixtures/gold/judge/holdout/golden.json
#   to live OUTSIDE june's git worktrees. chmod on in-tree copies is defeated
#   by `git worktree`. This script perms-seals the canonical paths and prints
#   a loud warning; externalizing the gauge is a separate repo-layout step.
#
# Idempotent. Scopes all iptables changes to a dedicated chain (RSI_JUNE_OUT)
# so it never flushes or clobbers Docker's rules.
# ============================================================================
set -euo pipefail

# ----------------------------------------------------------------------------
# POLICY — the only block you normally edit.
# ----------------------------------------------------------------------------
JUNE_USER="june"
JUNE_SHELL="/bin/bash"           # real shell: the optimizer runs commands as june
JUNE_HOME="/home/${JUNE_USER}"

PROXY_PORT=18080                 # local allowlisting proxy (loopback only)
PROXY_USER="${JUNE_USER}"        # proxy runs as june too; it only gates *hosts*

# EGRESS_MODE:
#   strict   → ALLOWLIST below is the whole world june's pipeline may reach.
#              Research is NOT possible as june (run the research/variation
#              operator as `cam`, which keeps open web). Strongest seal.
#   research → DENYLIST: june may reach the open web (for research) EXCEPT the
#              hosted-LLM-inference hosts. Weaker — a creative mutation could
#              tunnel out via an allowed host. Use only if the optimizer itself
#              (as june) must browse.  <-- DECISION PENDING (see chat)
EGRESS_MODE="strict"

# Hosts the pipeline legitimately needs. NOTE: Ollama is REMOTE here
# (your GPU box over the LAN/VPN) — "local" means trust-domain-local, not 127.0.0.1.
# Read from $RSI_OLLAMA_HOST so no personal hostname lives in source — export it
# before running, e.g.  RSI_OLLAMA_HOST=ollama.your-lan.example
OLLAMA_HOST="${RSI_OLLAMA_HOST:?set RSI_OLLAMA_HOST to your Ollama host (e.g. ollama.your-lan.example)}"
ALLOWLIST_HOSTS=(
  "${OLLAMA_HOST}"               # Ollama: gemma reader, planner, embedder, summarizer
  # "api.deepseek.com"           # OPTIONAL: flash screening reader. Same host also
                                 #   serves the FORBIDDEN deepseek-judge — egress
                                 #   cannot tell them apart; the belt (src/lib/modes.ts
                                 #   + role config) is what enforces role. Uncomment
                                 #   only when the two-speed flash screen is wired.
)
# Qdrant is loopback (127.0.0.1:6333) and always allowed via the localhost rule.

# Hosts that must NEVER be reachable by the pipeline (the actual anti-cheat).
DENYLIST_HOSTS=(
  "api.anthropic.com"
  "api.openai.com"
)

# Gauge paths to perms-seal (relative to repo root). See SEALING THE GAUGE.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
GAUGE_PATHS=(
  "packages/mcp/bench/fixtures"          # glorbulon-*, holdout-real, queries+gold
  "packages/mcp/bench/golden.json"       # pinned baselines
  "packages/mcp/bench/prompts/judge.md"  # judge rubric (adjust if named differently)
)
GAUGE_OWNER="root"                       # owner june cannot read as

# ----------------------------------------------------------------------------
# 0. Preflight
# ----------------------------------------------------------------------------
log()  { printf '\033[1;34m[provision]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[FATAL]\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "must run as root (sudo)."

for bin in useradd iptables getent install python3; do
  command -v "$bin" >/dev/null || die "missing required tool: $bin"
done

# owner-match was UNCONFIRMED on this kernel during probing — verify or bail.
if ! iptables -m owner --help >/dev/null 2>&1; then
  die "iptables 'owner' match (xt_owner) unavailable. Try: modprobe xt_owner.
       Without it, fall back to the netns+slirp4netns mechanism (Option A)."
fi

# ----------------------------------------------------------------------------
# 1. Create the unprivileged `june` user
# ----------------------------------------------------------------------------
if getent passwd "$JUNE_USER" >/dev/null; then
  log "user '$JUNE_USER' exists — leaving as-is."
else
  log "creating user '$JUNE_USER'."
  useradd --create-home --home-dir "$JUNE_HOME" --shell "$JUNE_SHELL" "$JUNE_USER"
fi

# 1a. Hard-assert NO privilege groups. (Belt: also re-check on every boot.)
for grp in sudo docker wheel root adm; do
  if id -nG "$JUNE_USER" | tr ' ' '\n' | grep -qx "$grp"; then
    warn "removing '$JUNE_USER' from privileged group '$grp'."
    gpasswd -d "$JUNE_USER" "$grp" || deluser "$JUNE_USER" "$grp" || true
  fi
done
# 1b. No sudoers entry.
rm -f "/etc/sudoers.d/${JUNE_USER}" 2>/dev/null || true
log "privilege check: $JUNE_USER groups = [$(id -nG "$JUNE_USER")]"

JUNE_UID="$(id -u "$JUNE_USER")"

# ----------------------------------------------------------------------------
# 2. Install the local allowlisting CONNECT proxy (loopback-only choke point)
# ----------------------------------------------------------------------------
PROXY_DIR="/opt/rsi-sandbox"
PROXY_BIN="${PROXY_DIR}/connect-allowlist-proxy.py"
PROXY_ALLOW="${PROXY_DIR}/allow.hosts"
PROXY_DENY="${PROXY_DIR}/deny.hosts"
PROXY_LOG="/var/log/rsi-egress.log"

install -d -m 0755 "$PROXY_DIR"
printf '%s\n' "${ALLOWLIST_HOSTS[@]}" > "$PROXY_ALLOW"
printf '%s\n' "${DENYLIST_HOSTS[@]}"  > "$PROXY_DENY"
: > "$PROXY_LOG"; chown "$PROXY_USER" "$PROXY_LOG"

cat > "$PROXY_BIN" <<'PYEOF'
#!/usr/bin/env python3
# Minimal HTTPS CONNECT allowlisting proxy. No MITM: it allows/denies by the
# CONNECT target host (SNI-equivalent) and then blind-tunnels bytes. Every
# decision is logged — this log IS the proxy-hacking audit trail.
import os, socket, select, threading, sys, datetime

PORT   = int(os.environ.get("RSI_PROXY_PORT", "18080"))
MODE   = os.environ.get("RSI_EGRESS_MODE", "strict")   # strict | research
ALLOW  = set(l.strip() for l in open(os.environ["RSI_ALLOW"]) if l.strip() and not l.startswith("#"))
DENY   = set(l.strip() for l in open(os.environ["RSI_DENY"])  if l.strip() and not l.startswith("#"))
LOGF   = os.environ.get("RSI_LOG", "/var/log/rsi-egress.log")

def log(verdict, host, port):
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    with open(LOGF, "a") as f:
        f.write(f"{ts} {verdict} {host}:{port}\n")

def permitted(host):
    if host in DENY:                      # denylist always wins
        return False
    if MODE == "strict":
        return host in ALLOW
    return True                           # research: open except DENY

def pipe(a, b):
    try:
        while True:
            r, _, _ = select.select([a, b], [], [])
            for s in r:
                data = s.recv(65536)
                if not data:
                    return
                (b if s is a else a).sendall(data)
    except OSError:
        return

def handle(client):
    try:
        req = b""
        while b"\r\n\r\n" not in req:
            chunk = client.recv(4096)
            if not chunk:
                client.close(); return
            req += chunk
        line = req.split(b"\r\n", 1)[0].decode("latin1")
        method, target = line.split(" ")[0], line.split(" ")[1]
        if method.upper() != "CONNECT":
            client.sendall(b"HTTP/1.1 405 Only CONNECT\r\n\r\n"); client.close(); return
        host, _, port = target.partition(":")
        port = int(port or "443")
        if not permitted(host):
            log("DENY", host, port)
            client.sendall(b"HTTP/1.1 403 Forbidden (RSI egress policy)\r\n\r\n")
            client.close(); return
        log("ALLOW", host, port)
        upstream = socket.create_connection((host, port), timeout=15)
        client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
        threading.Thread(target=pipe, args=(client, upstream), daemon=True).start()
        pipe(upstream, client)
    except Exception as e:
        try: client.sendall(b"HTTP/1.1 502 Bad Gateway\r\n\r\n")
        except OSError: pass
    finally:
        try: client.close()
        except OSError: pass

def main():
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", PORT))         # loopback only — never exposed
    srv.listen(128)
    print(f"rsi-egress-proxy: 127.0.0.1:{PORT} mode={MODE} "
          f"allow={len(ALLOW)} deny={len(DENY)}", file=sys.stderr)
    while True:
        c, _ = srv.accept()
        threading.Thread(target=handle, args=(c,), daemon=True).start()

if __name__ == "__main__":
    main()
PYEOF
chmod 0755 "$PROXY_BIN"

# 2a. systemd unit so the proxy survives reboot.
cat > /etc/systemd/system/rsi-egress-proxy.service <<EOF
[Unit]
Description=RSI sandbox egress allowlist proxy (loopback)
After=network.target

[Service]
User=${PROXY_USER}
Environment=RSI_PROXY_PORT=${PROXY_PORT}
Environment=RSI_EGRESS_MODE=${EGRESS_MODE}
Environment=RSI_ALLOW=${PROXY_ALLOW}
Environment=RSI_DENY=${PROXY_DENY}
Environment=RSI_LOG=${PROXY_LOG}
ExecStart=/usr/bin/python3 ${PROXY_BIN}
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now rsi-egress-proxy.service
log "egress proxy up on 127.0.0.1:${PROXY_PORT} (mode=${EGRESS_MODE})."

# ----------------------------------------------------------------------------
# 3. iptables owner-match: force uid=june through the proxy, drop the rest.
#    Scoped to a private chain so we NEVER touch Docker's rules.
# ----------------------------------------------------------------------------
CHAIN="RSI_JUNE_OUT"

# (re)build our chain idempotently
iptables -N "$CHAIN" 2>/dev/null || iptables -F "$CHAIN"

# allow loopback (the proxy itself + Qdrant on 127.0.0.1:6333)
iptables -A "$CHAIN" -o lo -j ACCEPT
iptables -A "$CHAIN" -d 127.0.0.1 -j ACCEPT
# allow DNS (proxy resolves hostnames; june needs name resolution)
iptables -A "$CHAIN" -p udp --dport 53 -j ACCEPT
iptables -A "$CHAIN" -p tcp --dport 53 -j ACCEPT
# allow june -> the local proxy port (this is the ONLY way out)
iptables -A "$CHAIN" -p tcp -d 127.0.0.1 --dport "$PROXY_PORT" -j ACCEPT
# everything else from june: drop + log (rate-limited)
iptables -A "$CHAIN" -m limit --limit 6/min -j LOG --log-prefix "RSI_JUNE_DROP "
iptables -A "$CHAIN" -j REJECT --reject-with icmp-port-unreachable

# jump into our chain for uid=june, once
if ! iptables -C OUTPUT -m owner --uid-owner "$JUNE_UID" -j "$CHAIN" 2>/dev/null; then
  iptables -I OUTPUT -m owner --uid-owner "$JUNE_UID" -j "$CHAIN"
fi
log "iptables owner-match installed for uid=${JUNE_UID} -> ${CHAIN}."

# 3a. persist across reboot via a oneshot unit (WSL has no netfilter-persistent
#     by default). Saves the *current* ruleset and restores on boot.
install -d -m 0755 /etc/rsi-sandbox
iptables-save > /etc/rsi-sandbox/iptables.rules
cat > /etc/systemd/system/rsi-egress-iptables.service <<EOF
[Unit]
Description=Restore RSI sandbox iptables rules
Before=rsi-egress-proxy.service
After=network-pre.target
Wants=network-pre.target

[Service]
Type=oneshot
ExecStart=/sbin/iptables-restore --noflush /etc/rsi-sandbox/iptables.rules
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable rsi-egress-iptables.service
log "iptables persistence unit installed."

# Tell june's processes to use the proxy. (Belt: HTTPS_PROXY is honored by the
# Anthropic/OpenAI SDKs and Bun fetch; iptables is the suspenders if they don't.)
cat > "${JUNE_HOME}/.rsi-egress.env" <<EOF
export HTTPS_PROXY=http://127.0.0.1:${PROXY_PORT}
export HTTP_PROXY=http://127.0.0.1:${PROXY_PORT}
export NO_PROXY=127.0.0.1,localhost
EOF
chown "$JUNE_USER" "${JUNE_HOME}/.rsi-egress.env"
grep -q '.rsi-egress.env' "${JUNE_HOME}/.bashrc" 2>/dev/null \
  || echo "source ~/.rsi-egress.env" >> "${JUNE_HOME}/.bashrc"

# ----------------------------------------------------------------------------
# 4. SEALING THE GAUGE (perms only — see the warning)
# ----------------------------------------------------------------------------
log "perms-sealing gauge paths (owner=${GAUGE_OWNER}, june no-read)..."
for rel in "${GAUGE_PATHS[@]}"; do
  p="${REPO_ROOT}/${rel}"
  if [[ -e "$p" ]]; then
    chown -R "$GAUGE_OWNER":"$GAUGE_OWNER" "$p"
    if [[ -d "$p" ]]; then chmod -R go-rwx "$p"; chmod 0700 "$p"; else chmod 0600 "$p"; fi
    log "  sealed: $rel"
  else
    warn "  gauge path not found (adjust GAUGE_PATHS): $rel"
  fi
done
warn "GAUGE SEAL IS PARTIAL: git worktrees give june its own readable copy of"
warn "anything in-tree. The no-read guarantee (§1) requires EXTERNALIZING the"
warn "gauge out of june's worktrees behind the privileged evaluator. Perms here"
warn "only protect the canonical /home/cam checkout, which june can't traverse"
warn "anyway. Treat this as defense-in-depth, not the seal."

# ----------------------------------------------------------------------------
# 5. Verification (run the checks as june)
# ----------------------------------------------------------------------------
log "verifying as ${JUNE_USER}..."
run_as_june() { sudo -u "$JUNE_USER" -- bash -lc "$1"; }

echo "  [egress] anthropic (expect FAIL):"
run_as_june "curl -sS --max-time 8 https://api.anthropic.com/ -o /dev/null -w '    -> HTTP %{http_code}\n' || echo '    -> blocked (good)'"
echo "  [egress] ollama host (expect reachable):"
run_as_june "curl -sS --max-time 8 https://${ALLOWLIST_HOSTS[0]}/ -o /dev/null -w '    -> HTTP %{http_code}\n' || echo '    -> UNREACHABLE (check policy)'"
echo "  [privilege] sudo (expect denied):"
run_as_june "sudo -n true 2>/dev/null && echo '    -> HAS SUDO (BAD)' || echo '    -> no sudo (good)'"
echo "  [privilege] docker (expect denied):"
run_as_june "docker ps >/dev/null 2>&1 && echo '    -> HAS DOCKER (BAD)' || echo '    -> no docker (good)'"

log "done. Egress log: ${PROXY_LOG}   (tail -f to watch the choke point)"
log "To remove: systemctl disable --now rsi-egress-proxy rsi-egress-iptables;"
log "           iptables -D OUTPUT -m owner --uid-owner ${JUNE_UID} -j ${CHAIN};"
log "           iptables -F ${CHAIN}; iptables -X ${CHAIN}"
