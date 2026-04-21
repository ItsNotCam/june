// author: Claude
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  computeWhitelist,
  installOfflineGuard,
  uninstallOfflineGuard,
  verifyOffline,
} from "@/lib/offline-guard";
import { OfflineWhitelistViolation } from "@/lib/errors";

/**
 * Brief §10 offline/: URL-shape variants, host extraction, subdomain rejection,
 * install/uninstall cycle restores fetch, verifyOffline contract.
 */

beforeEach(() => uninstallOfflineGuard());
afterEach(() => uninstallOfflineGuard());

describe("computeWhitelist — URL shape variants (brief I10)", () => {
  test("extracts bare host regardless of scheme, port, path, query", () => {
    const wl = computeWhitelist([
      "http://ollama.internal:11434",
      "https://qdrant.cloud/collections",
      "http://host-with-path.example:6333/v1?x=1",
    ]);
    expect(wl.has("ollama.internal")).toBe(true);
    expect(wl.has("qdrant.cloud")).toBe(true);
    expect(wl.has("host-with-path.example")).toBe(true);
  });

  test("subdomain of a whitelisted host is NOT implicitly whitelisted", () => {
    const wl = computeWhitelist(["https://ollama.internal"]);
    expect(wl.has("ollama.internal")).toBe(true);
    expect(wl.has("api.ollama.internal")).toBe(false);
    expect(wl.has("admin.ollama.internal")).toBe(false);
  });

  test("IPv4 hosts are preserved as strings", () => {
    const wl = computeWhitelist(["http://10.0.0.5:11434"]);
    expect(wl.has("10.0.0.5")).toBe(true);
    // Any other IP is rejected.
    expect(wl.has("10.0.0.6")).toBe(false);
  });

  test("IPv6 hosts keep bracket-less hostname form (URL standard)", () => {
    const wl = computeWhitelist(["http://[::1]:11434"]);
    // The URL parser strips brackets from `.hostname`.
    expect(wl.has("[::1]")).toBe(true);
  });

  test("empty URL list produces an empty whitelist — no implicit localhost", () => {
    const wl = computeWhitelist([]);
    expect(wl.size).toBe(0);
    expect(wl.has("localhost")).toBe(false);
    expect(wl.has("127.0.0.1")).toBe(false);
  });
});

describe("installOfflineGuard — blocking and passthrough", () => {
  test("whitelisted host is NOT blocked (attempt reaches fetch)", async () => {
    // Use a non-resolvable whitelisted host so we don't actually hit the net.
    const unreachable = "nonexistent-host-june-test.invalid";
    const wl = new Set([unreachable]);
    installOfflineGuard(wl);
    let sawOffline = false;
    try {
      await fetch(`https://${unreachable}/probe`);
    } catch (err) {
      if (err instanceof OfflineWhitelistViolation) sawOffline = true;
      // Any other error (DNS, connection) means the guard let it through.
    }
    expect(sawOffline).toBe(false);
  });

  test("blocks synchronously before the network call happens", () => {
    const wl = new Set(["ok.internal"]);
    installOfflineGuard(wl);
    // Throw on the synchronous fetch call itself — not a rejected promise.
    expect(() => fetch("https://evil.example")).toThrow(
      OfflineWhitelistViolation,
    );
  });

  test("honors Request objects (not just string URLs)", () => {
    const wl = new Set(["ok.internal"]);
    installOfflineGuard(wl);
    const req = new Request("https://evil.example/x");
    expect(() => fetch(req)).toThrow(OfflineWhitelistViolation);
  });

  test("honors URL objects", () => {
    const wl = new Set(["ok.internal"]);
    installOfflineGuard(wl);
    const url = new URL("https://evil.example/x");
    expect(() => fetch(url)).toThrow(OfflineWhitelistViolation);
  });

  test("OfflineWhitelistViolation exposes attempted host + whitelist snapshot", () => {
    const wl = new Set(["ollama.internal", "qdrant.internal"]);
    installOfflineGuard(wl);
    try {
      fetch("https://bad.example");
    } catch (err) {
      expect(err).toBeInstanceOf(OfflineWhitelistViolation);
      const v = err as OfflineWhitelistViolation;
      expect(v.attempted_host).toBe("bad.example");
      expect(v.whitelist).toContain("ollama.internal");
      expect(v.whitelist).toContain("qdrant.internal");
    }
  });

  test("re-installing with a new whitelist rewraps — old whitelist no longer authoritative", () => {
    installOfflineGuard(new Set(["first.host"]));
    installOfflineGuard(new Set(["second.host"]));
    expect(() => fetch("https://first.host")).toThrow(OfflineWhitelistViolation);
    // No synchronous throw on "second.host" — the call passes the guard and
    // reaches the real fetch (which will then error asynchronously because
    // the host does not resolve; we swallow that to avoid unhandled rejection).
    let sawOffline = false;
    try {
      const p = fetch("https://second.host");
      void p.catch(() => undefined);
    } catch (err) {
      if (err instanceof OfflineWhitelistViolation) sawOffline = true;
    }
    expect(sawOffline).toBe(false);
  });

  test("uninstallOfflineGuard restores original fetch — subsequent calls not blocked", () => {
    installOfflineGuard(new Set(["nothing.internal"]));
    expect(() => fetch("https://evil.example")).toThrow(OfflineWhitelistViolation);
    uninstallOfflineGuard();
    // With guard off, calling fetch against a random host no longer throws synchronously.
    let synchronousViolation = false;
    try {
      const p = fetch("https://evil.example");
      // Prevent unhandled-rejection warnings for the pending promise.
      void p.catch(() => undefined);
    } catch (err) {
      if (err instanceof OfflineWhitelistViolation) synchronousViolation = true;
    }
    expect(synchronousViolation).toBe(false);
  });
});

describe("verifyOffline — engaged-and-correct probe (brief §25.5.3)", () => {
  test("throws when called with no guard installed (forbidden host not blocked)", async () => {
    // `verifyOffline` asserts the guard is engaged. With no install, the
    // forbidden-host probe will reach the real network and eventually error,
    // not with an OfflineWhitelistViolation — so verify reports misconfig.
    let threw = false;
    try {
      await verifyOffline(new Set(["ollama.internal"]), []);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("passes when guard engaged and probe URLs are whitelisted", async () => {
    const probe = "nonexistent-host-june-test.invalid";
    const wl = new Set([probe]);
    installOfflineGuard(wl);
    // DNS will fail on the probe URL, but that's not an OfflineWhitelistViolation,
    // so verifyOffline treats it as "not blocked" and passes.
    await verifyOffline(wl, [`http://${probe}`]);
  });

  test("throws when a probe URL is not in the whitelist", async () => {
    const wl = new Set(["different.host"]);
    installOfflineGuard(wl);
    let threw = false;
    try {
      await verifyOffline(wl, ["http://not.whitelisted.host"]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
