-- Reconcile pre-existing data before tightening the constraint (CodeRabbit
-- review): the old index only forbade two PENDING rows for the same
-- tuple, so a deployment that already hit the race this migration closes
-- could have both a pending and an approved row for one requester+client+
-- group -- which the new "one non-denied row" index can't coexist with.
-- For each tuple with more than one non-denied row, keep the approved one
-- if there is one (else the oldest pending one) and deny the rest, so the
-- unique index below can actually be created. On a fresh/CI database (no
-- pre-existing data) this matches zero rows and is a no-op.
WITH ranked AS (
	SELECT id,
		ROW_NUMBER() OVER (
			PARTITION BY requester_subject, pocket_id_client_id, pocket_id_group_id
			ORDER BY (status = 'approved') DESC, created_at ASC
		) AS keep_rank
	FROM access_requests
	WHERE status != 'denied'
)
UPDATE access_requests
SET status = 'denied'
WHERE id IN (SELECT id FROM ranked WHERE keep_rank > 1);
--> statement-breakpoint
DROP INDEX "access_requests_pending_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "access_requests_pending_unique" ON "access_requests" USING btree ("requester_subject","pocket_id_client_id","pocket_id_group_id") WHERE "access_requests"."status" != 'denied';