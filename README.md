# console-method-interceptor-ts

Wraps the global `console` methods so that every call is forwarded to the original log while also being captured into a ring buffer for later retrieval.

```js
import { createInterceptor } from "console-method-interceptor-ts";

const interceptor = createInterceptor({ capacity: 50 });

console.log("user logged in", { id: 7 });
console.warn("slow query", 230);

const entries = interceptor.entries();
// [{ method: "log", args: ["user logged in", { id: 7 }] },
//  { method: "warn", args: ["slow query", 230] }]

interceptor.restore(); // put the original console methods back
```

## Why

Test suites and debugging tools often want to inspect what was logged without disabling normal output. This library intercepts every function-valued method on `console`, forwards the call unchanged, and stores a structured `{ method, args }` entry in a bounded ring buffer.

The captured `args` array is a shallow copy of the call's arguments. Values are **not** serialized — objects are captured by reference so you can assert on their shape directly in tests. The trade-off: if you mutate a logged object after the fact, the buffered reference sees the mutation. If you need a frozen snapshot, clone before logging.

## Edge cases

- `capacity` defaults to `100`. Non-positive or non-numeric values fall back to the default.
- `entries()` returns newest-last order. `drain()` returns the same and clears the buffer.
- Only own, enumerable, function-valued properties of the target are wrapped. Non-function properties on a custom target are left alone.
- `restore()` is idempotent in effect: after it returns the wrappers are gone and the buffer is left as-is for final inspection.
