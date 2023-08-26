# Stream-SQL Syntax & CEP Pattern Specification

Zephyr implements an expressive streaming SQL dialect extending standard SQL-92 with temporal tumbling, sliding, and session windows, stream-to-stream equi-joins, and complex event pattern recognition.

---

## Grammar Overview

```sql
SELECT select_item [, select_item ...]
FROM stream_name
[ JOIN right_stream ON join_condition WITHIN duration_interval ]
[ WHERE filter_expression ]
[ GROUP BY group_column [, group_column ...], WINDOW(...) ]
[ EMIT { CHANGES | FINAL } ];
```

---

## Windowing Models

### 1. Tumbling Window
Fixed-duration, non-overlapping time intervals.
```sql
SELECT symbol, COUNT(*) AS volume
FROM trades
GROUP BY symbol, WINDOW(TUMBLING, SIZE 10 SECONDS)
EMIT CHANGES;
```

### 2. Sliding Window (Hopping)
Overlapping time intervals of fixed length advancing by a constant step.
```sql
SELECT device_id, AVG(temperature) AS avg_temp
FROM sensor_stream
GROUP BY device_id, WINDOW(SLIDING, SIZE 1 MINUTE, ADVANCE 10 SECONDS)
EMIT FINAL;
```

### 3. Session Window
Dynamic gap-based windows characterized by periods of inactivity.
```sql
SELECT user_id, COUNT(*) AS click_count
FROM user_clicks
GROUP BY user_id, WINDOW(SESSION, TIMEOUT 30 SECONDS);
```

---

## Temporal Stream Joins

Joins two continuous streams matching keys within bounded time distance:
```sql
SELECT orders.id, shipments.tracking_number
FROM orders
JOIN shipments ON orders.id = shipments.order_id WITHIN 15 MINUTES;
```

---

## Complex Event Processing (CEP) Syntax

Patterns define non-deterministic finite automata (NFA-e) detecting sequences of correlated events:
```javascript
import { Pattern, CEPMatcher } from "zephyr";

// Detect fraudulent authentication pattern: failed login followed by locked account within 10s
const fraudPattern = Pattern.begin("FAIL")
  .where((e) => e.action === "LOGIN_FAILED")
  .next("LOCK")
  .where((e) => e.action === "ACCOUNT_LOCKED")
  .within(10000);

const matcher = new CEPMatcher(fraudPattern);
const matches = matcher.process(incomingEvent);
```
