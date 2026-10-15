ALTER TABLE "chains" ADD COLUMN "meta" jsonb;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "operator_address" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "details" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "commission_rate" double precision;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "tokens" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "min_self_delegation" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "bond_status" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "jailed" boolean;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "missed_blocks_counter" integer;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "jailed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "tombstoned" boolean;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "signing_start_height" integer;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "staking_synced_at" timestamp with time zone;