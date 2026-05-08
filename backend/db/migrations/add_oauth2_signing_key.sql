-- Migration: add oauth2_private_key column for per-agent PKJWT access token signing
-- Safe: adds nullable column, does not affect existing data
-- Run: sqlite3 agentic_commerce.db < backend/db/migrations/add_oauth2_signing_key.sql
-- Or auto-applied via SQLAlchemy create_all() on new DBs

ALTER TABLE agents ADD COLUMN oauth2_private_key TEXT;