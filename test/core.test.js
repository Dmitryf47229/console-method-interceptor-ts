import { test } from "node:test";
import assert from "node:assert/strict";

import { createInterceptor } from "../src/index.js";

// A tiny fake console so we never depend on or mutate the real global console
// during tests. This keeps tests deterministic and side-effect free.
function makeFakeConsole() {
  return {
    calls: [],
    log(...args) {
      this.calls.push({ method: "log", args });
    },
    warn(...args) {
      this.calls.push({ method: "warn", args });
    },
    error(...args) {
      this.calls.push({ method: "error", args });
    },
    info(...args) {
      this.calls.push({ method: "info", args });
    },
  };
}

test("forwards calls to the original method", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.log("hello", 42);
  interceptor.restore();
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0], { method: "log", args: ["hello", 42] });
});

test("captures method name and arguments into entries", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.log("a");
  fake.warn("b", "c");
  interceptor.restore();
  const entries = interceptor.entries();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].method, "log");
  assert.deepEqual(entries[0].args, ["a"]);
  assert.equal(entries[1].method, "warn");
  assert.deepEqual(entries[1].args, ["b", "c"]);
});

test("entries returns newest-last order", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.log("first");
  fake.log("second");
  fake.log("third");
  interceptor.restore();
  const entries = interceptor.entries();
  assert.deepEqual(
    entries.map((e) => e.args[0]),
    ["first", "second", "third"],
  );
});

test("ring buffer evicts oldest entries when capacity exceeded", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake, capacity: 2 });
  fake.log("one");
  fake.log("two");
  fake.log("three");
  interceptor.restore();
  const entries = interceptor.entries();
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.args[0]),
    ["two", "three"],
  );
});

test("drain returns entries and clears the buffer", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.log("x");
  interceptor.restore();
  const drained = interceptor.drain();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].method, "log");
  assert.deepEqual(drained[0].args, ["x"]);
  assert.equal(interceptor.entries().length, 0);
  assert.equal(interceptor.size(), 0);
});

test("restore puts the original methods back", () => {
  const fake = makeFakeConsole();
  const originalLog = fake.log;
  const interceptor = createInterceptor({ target: fake });
  assert.notEqual(fake.log, originalLog);
  interceptor.restore();
  assert.equal(fake.log, originalLog);
});

test("captured args are a copy, not the live arguments object", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  const obj = { n: 1 };
  fake.log(obj);
  interceptor.restore();
  const entries = interceptor.entries();
  // Mutate the original object; the captured reference still points to the
  // same object (we do not deep-clone), but the args array itself is a copy.
  obj.n = 999;
  assert.equal(entries[0].args.length, 1);
  assert.equal(entries[0].args[0].n, 999);
  // Verify it's a real Array, not an Arguments object.
  assert.equal(Array.isArray(entries[0].args), true);
});

test("size reflects current buffer length", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake, capacity: 10 });
  assert.equal(interceptor.size(), 0);
  fake.log("a");
  assert.equal(interceptor.size(), 1);
  fake.warn("b");
  assert.equal(interceptor.size(), 2);
  interceptor.restore();
});

test("capacity returns the configured value", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake, capacity: 25 });
  assert.equal(interceptor.capacity(), 25);
  interceptor.restore();
});

test("default capacity is 100", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  assert.equal(interceptor.capacity(), 100);
  interceptor.restore();
});

test("invalid capacity falls back to default", () => {
  const fake = makeFakeConsole();
  const i1 = createInterceptor({ target: fake, capacity: 0 });
  assert.equal(i1.capacity(), 100);
  i1.restore();
  const i2 = createInterceptor({ target: fake, capacity: -5 });
  assert.equal(i2.capacity(), 100);
  i2.restore();
  const i3 = createInterceptor({ target: fake, capacity: NaN });
  assert.equal(i3.capacity(), 100);
  i3.restore();
});

test("captures structured values without serializing", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.error({ id: 7, nested: [1, 2, 3] });
  interceptor.restore();
  const [entry] = interceptor.entries();
  assert.equal(entry.method, "error");
  assert.equal(entry.args[0].id, 7);
  assert.deepEqual(entry.args[0].nested, [1, 2, 3]);
});

test("returns the original method's return value", () => {
  const fake = {
    value: 42,
    log(...args) {
      return this.value;
    },
  };
  const interceptor = createInterceptor({ target: fake });
  const result = fake.log("ignored");
  interceptor.restore();
  assert.equal(result, 42);
});

test("wraps all function-valued console methods", () => {
  const fake = makeFakeConsole();
  const interceptor = createInterceptor({ target: fake });
  fake.log("l");
  fake.warn("w");
  fake.error("e");
  fake.info("i");
  interceptor.restore();
  const methods = interceptor.entries().map((e) => e.method);
  assert.deepEqual(methods.sort(), ["error", "info", "log", "warn"]);
});

test("does not wrap non-function properties", () => {
  const fake = {
    calls: [],
    level: 3,
    log(...args) {
      this.calls.push({ method: "log", args });
    },
  };
  const interceptor = createInterceptor({ target: fake });
  // The non-function property should be untouched.
  assert.equal(fake.level, 3);
  fake.log("hi");
  interceptor.restore();
  assert.equal(fake.calls.length, 1);
});
