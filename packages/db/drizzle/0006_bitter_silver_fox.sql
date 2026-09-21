CREATE TABLE "sales_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"book_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"revenue_micros" integer DEFAULT 0 NOT NULL,
	"royalty_micros" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sales_records_book_idx" ON "sales_records" USING btree ("book_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_records_period_unique" ON "sales_records" USING btree ("book_id","channel","period_start","period_end");