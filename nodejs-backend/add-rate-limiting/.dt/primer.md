# Mission Primer: Rate Limiting Vocabulary

**Rate limiting** — a technique to control how many requests a client can make within a defined time window. Prevents abuse, protects server resources, and ensures fair usage.

**Fixed window** — divides time into discrete chunks (e.g. minute 0–60, 60–120). The counter resets at the start of each window. Simple to implement; susceptible to burst traffic at window boundaries.

**Sliding window** — tracks requests relative to *now* minus the window size, not a fixed boundary. Smoother than fixed window; eliminates boundary bursts.

**Token bucket** — clients hold a bucket of tokens replenished at a fixed rate. Each request consumes a token. Allows short bursts while enforcing an average rate over time.

**Redis INCR** — atomically increments an integer key and returns the new value. Safe for concurrent use across multiple server instances.

**Redis EXPIRE** — sets a key's TTL (time-to-live). Once the TTL reaches zero, Redis automatically deletes the key.

**TTL (Time To Live)** — how long, in seconds, before a Redis key expires and is removed. Used here to define the rate limit window duration.

**429 Too Many Requests** — the HTTP status code indicating the client has sent too many requests in a given period.

**Retry-After** — a response header accompanying 429 responses. Its value is the number of seconds the client should wait before retrying.

**X-RateLimit-Remaining** — a response header indicating how many requests the client has left in the current window. Helps clients self-throttle before hitting the limit.
