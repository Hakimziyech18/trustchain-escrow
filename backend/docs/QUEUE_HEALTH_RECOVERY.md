# Queue health reporting — recovery runbook

This runbook is for the **queue dashboard only**, mounted at `/admin/queues`.
Do not use it to reset unrelated queue workers or purge application data.
Access to the dashboard must be restricted to trusted operators at the
network/proxy level: its mounted routes currently have no in-route admin guard.
Do not expose the endpoints to the public internet.

## Detection

1. Check `GET /admin/queues/stats`: inspect `redis.connected`, queue counts,
   `alerts.highFailureRate` and `alerts.queueProcessingActive`.
2. Inspect `GET /admin/queues/jobs?state=failed&limit=10` or the dead-letter
   queue. Avoid exporting raw job payloads or logs to a public incident channel.
3. Confirm Redis availability and worker health using existing deployment
   monitoring. A failed stats request is **not** evidence that data was lost.
4. Record observation time, affected queue (`main` / `dead-letter`), counts,
   and sanitized error category; never record credentials or job payloads.

## Mitigation

1. Identify the failing dependency before retrying jobs. Pause processing via
   `POST /admin/queues/queue/pause?queue=main` **only if necessary** to prevent
   continued failures; coordinate with the on-call operator.
2. Repair the dependency and validate Redis connectivity and queue metrics.
3. Retry an individual failed job via `POST /admin/queues/jobs/:id/retry`
   **only after** verifying it is safe to replay (idempotency/side effects).
4. Resume processing via `POST /admin/queues/queue/resume?queue=main` and
   observe waiting/active/failed counts. Never clean waiting or active jobs.

## Safe retention and cleanup

`POST /admin/queues/cleanup` accepts this JSON body:

```json
{"state":"completed","queue":"main","keepLast":100,"olderThanMs":86400000}
```

- `state`: exactly `completed` or `failed` (default: `completed`).
- `queue`: `main` or `dead-letter` (default: `main`).
- `keepLast`: **legacy parameter name**; BullMQ treats it as maximum jobs
  **removed per call**, NOT number retained. Integer `1`–`1000`, default `100`.
- `olderThanMs`: minimum job age before deletion, in milliseconds; integer
  between one minute and 30 days, default one day.
- Result: `cleanedCount` is the number removed; raw job IDs are not returned.
- Cleanup is manual and bounded per request. No automatic expiry scheduler is
  introduced here. The existing queue defaults also cap retained terminal jobs.

**Caution:** Completed and failed history may be needed for investigations.
Before deleting failed or dead-letter jobs, ensure remediation and evidence
retention requirements have been met. Never run cleanup against production
without prior authorisation and a verified backup. Repeated calls can remove
more than the per-call limit. `clean()` is irreversible for removed jobs.

## Rollback

1. Stop invoking cleanup. If processing was paused, only resume once safe.
2. If the change caused errors, deploy the previous backend release; restore
   the previously approved cleanup policy. A code rollback cannot recreate
   deleted jobs.
3. If deletion was unintended, follow the team's Redis backup/restore process
   under incident control. Do not overwrite live queue state blindly; recovery
   may require reconciling processing side effects.

## Verification and escalation

1. Recheck `/stats` and terminal-job counts for both queues; look for a stable
   Redis connection and an improving or steady failure rate.
2. Perform a limited known-safe replay if needed and verify the external effect
   occurs no more than once.
3. Test a valid cleanup against a non-production queue and confirm the response
   count matches the removed jobs. Invalid state/queue/count/age must yield 400.
4. If Redis remains unavailable, retries continue failing, or job counts fall
   unexpectedly, escalate to incident response; preserve existing evidence and
   record the rollout version and validation results.
