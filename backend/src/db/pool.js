import pg from "pg";
import dotenv from "dotenv";
import { databaseSslOptions } from "./ssl.js";
dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslOptions(),
  max: Number(process.env.DB_POOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
