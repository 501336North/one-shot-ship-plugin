/**
 * Test helper for release-channels.api.integration.test.sh (ship round 4, UR8): keeps a node process on loopback.
 * Loaded first by api-harness.ts and decrypt-with-key.ts, and with `node --require` for the CLI bundle.
 *
 * Every TCP/TLS connect (net.Socket#connect, which net.connect, tls.connect, http(s) and fetch all reach) and every DNS
 * lookup of a name that is not loopback is REFUSED before it starts, and recorded as one line in the file named by
 * OSS_ITEST_EGRESS_LOG ("<pid> connect|dns <host>"). The test asserts that file is empty. Unix-socket connects are
 * local and allowed.
 */
'use strict';
const fs = require('fs');
const net = require('net');
const dns = require('dns');

const LOG = process.env.OSS_ITEST_EGRESS_LOG || '';
const LOOPBACK = new Set(['127.0.0.1', '::1', '[::1]', 'localhost', '::ffff:127.0.0.1']);
const isLoopback = (host) => LOOPBACK.has(String(host).toLowerCase());
const record = (kind, host) => {
  if (LOG) fs.appendFileSync(LOG, `${process.pid} ${kind} ${host}\n`);
};
const refusal = (host) => Object.assign(new Error(`egress-guard: refused non-loopback host ${host}`), { code: 'ECONNREFUSED' });

// The host a connect call names: (options[, cb]), ([options, cb] normalized by net.connect), (port[, host][, cb]),
// or (path[, cb]) for a Unix socket (null: local).
function targetHost(args) {
  let first = args[0];
  if (Array.isArray(first)) first = first[0];
  if (first && typeof first === 'object') {
    if (first.path) return null;
    return first.host || 'localhost';
  }
  if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    return typeof args[1] === 'string' ? args[1] : 'localhost';
  }
  return null;
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const host = targetHost(args);
  if (host !== null && !isLoopback(host)) {
    record('connect', host);
    process.nextTick(() => this.destroy(refusal(host)));
    return this;
  }
  return connect.apply(this, args);
};

// DNS: a lookup of a non-loopback name fails at once (nodemailer resolves before it connects).
const wrapCallback = (name, original) =>
  function guardedDns(host, ...rest) {
    if (!isLoopback(host)) {
      record('dns', host);
      const cb = rest[rest.length - 1];
      const err = Object.assign(new Error(`egress-guard: refused DNS ${name} ${host}`), { code: 'ENOTFOUND' });
      if (typeof cb === 'function') process.nextTick(() => cb(err));
      return undefined;
    }
    return original.call(this, host, ...rest);
  };
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx']) {
  if (typeof dns[name] === 'function') dns[name] = wrapCallback(name, dns[name]);
}
for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx']) {
  const original = dns.promises[name];
  if (typeof original !== 'function') continue;
  dns.promises[name] = function guardedDnsPromise(host, ...rest) {
    if (!isLoopback(host)) {
      record('dns', host);
      return Promise.reject(Object.assign(new Error(`egress-guard: refused DNS ${name} ${host}`), { code: 'ENOTFOUND' }));
    }
    return original.call(this, host, ...rest);
  };
}
