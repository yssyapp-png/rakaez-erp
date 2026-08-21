import fs from "fs";
import path from "path";

const bundledSupabaseCa = new URL("../../certs/supabase-ca-2021.crt", import.meta.url);

export function databaseSslOptions(environment = process.env) {
  if (environment.DB_SSL !== "true") return undefined;

  const certificateFile = environment.DB_SSL_CA_FILE
    ? path.resolve(environment.DB_SSL_CA_FILE)
    : bundledSupabaseCa;
  const ca = fs.readFileSync(certificateFile, "utf8");

  return {
    ca,
    rejectUnauthorized: true,
  };
}
