import { describe, it, expect, afterEach } from "vitest";
import { databaseConnectionOptions } from "@workspace/db";

describe("database TLS policy", () => {
  afterEach(() => {
    delete process.env.DATABASE_TLS_INSECURE;
  });

  it("verifies certificates for a managed database by default and drops sslmode", () => {
    const o = databaseConnectionOptions("postgresql://u:p@ep-x.ap-southeast-1.aws.neon.tech/db?sslmode=require&channel_binding=require");
    expect(o.ssl).toEqual({ rejectUnauthorized: true });
    expect(o.connectionString).not.toContain("sslmode");
    expect(o.connectionString).toContain("channel_binding=require");
  });

  it("allows an explicit opt-out for poolers with a self-signed chain", () => {
    process.env.DATABASE_TLS_INSECURE = "true";
    expect(databaseConnectionOptions("postgresql://u:p@pooler.supabase.com:6543/postgres?sslmode=require").ssl).toEqual({ rejectUnauthorized: false });
  });

  it("uses no TLS for a local database", () => {
    expect(databaseConnectionOptions("postgres://lms:lms@localhost:5432/lms").ssl).toBeUndefined();
  });
});
